use anchor_lang::prelude::*;
use anchor_lang::system_program;
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token::{self, Mint, Token, TokenAccount, Transfer};

declare_id!("129TM1kMKESrr3rVGsd8ca3L8FtQPHd5KzHVsrzFqN4x");

#[program]
pub mod workspace {
    use super::*;

    // fee_bps: u16, Platform fee in basis points, 0 = no fee
    // reserve: Pubkey, Fee collection address, 11111111111111111111111111111111
    pub fn initialize_config(
        ctx: Context<InitializeConfig>,
        fee_bps: u16,
        reserve: Pubkey,
    ) -> Result<()> {
        let config = &mut ctx.accounts.config;
        config.bump = ctx.bumps.config;
        config.authority = ctx.accounts.authority.key();
        config.is_active = true;
        config.is_paused = false;
        config.fee_bps = fee_bps;
        config.reserve = reserve;
        config.version = 1;
        Ok(())
    }

    pub fn create_escrow(
        ctx: Context<CreateEscrow>,
        recipient: Pubkey,
        amount: u64,
        token_type: u8,
        token_mint: Option<Pubkey>,
        timeout_seconds: Option<i64>,
        memo: String,
        nonce: String,
    ) -> Result<()> {
        require!(memo.len() <= 100, ErrorCode::MemoTooLong);
        require!(nonce.len() <= 32, ErrorCode::NonceTooLong);
        require!(amount > 0, ErrorCode::InvalidAmount);
        require!(token_type <= 1, ErrorCode::InvalidParameter);

        if token_type == 1 {
            require!(token_mint.is_some(), ErrorCode::InvalidParameter);
        }

        let clock = Clock::get()?;
        let escrow = &mut ctx.accounts.escrow;
        escrow.creator = ctx.accounts.creator.key();
        escrow.recipient = recipient;
        escrow.amount = amount;
        escrow.token_type = token_type;
        escrow.token_mint = token_mint.unwrap_or(System::id());
        escrow.status = 0; // Created
        escrow.timeout_seconds = timeout_seconds.unwrap_or(0);
        escrow.created_at = clock.unix_timestamp;
        escrow.funded_at = 0;
        escrow.memo = memo;
        escrow.nonce = nonce;
        escrow.bump = ctx.bumps.escrow;

        Ok(())
    }

    pub fn fund_escrow_sol(ctx: Context<FundEscrowSol>) -> Result<()> {
        let escrow = &ctx.accounts.escrow;
        require!(escrow.status == 0, ErrorCode::InvalidStatus);
        require!(escrow.token_type == 0, ErrorCode::InvalidParameter);
        require!(
            escrow.creator == ctx.accounts.creator.key(),
            ErrorCode::Unauthorized
        );

        let amount = escrow.amount;

        system_program::transfer(
            CpiContext::new(
                ctx.accounts.system_program.to_account_info(),
                system_program::Transfer {
                    from: ctx.accounts.creator.to_account_info(),
                    to: ctx.accounts.vault.to_account_info(),
                },
            ),
            amount,
        )?;

        let escrow = &mut ctx.accounts.escrow;
        escrow.status = 1; // Funded
        escrow.funded_at = Clock::get()?.unix_timestamp;

        Ok(())
    }

    pub fn fund_escrow_spl(ctx: Context<FundEscrowSpl>) -> Result<()> {
        let escrow = &ctx.accounts.escrow;
        require!(escrow.status == 0, ErrorCode::InvalidStatus);
        require!(escrow.token_type == 1, ErrorCode::InvalidParameter);
        require!(
            escrow.creator == ctx.accounts.creator.key(),
            ErrorCode::Unauthorized
        );
        require!(
            escrow.token_mint == ctx.accounts.token_mint.key(),
            ErrorCode::InvalidParameter
        );

        let amount = escrow.amount;

        token::transfer(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.creator_token_account.to_account_info(),
                    to: ctx.accounts.escrow_token_account.to_account_info(),
                    authority: ctx.accounts.creator.to_account_info(),
                },
            ),
            amount,
        )?;

        let escrow = &mut ctx.accounts.escrow;
        escrow.status = 1; // Funded
        escrow.funded_at = Clock::get()?.unix_timestamp;

        Ok(())
    }

    pub fn release_escrow_sol(ctx: Context<ReleaseEscrowSol>) -> Result<()> {
        let escrow = &ctx.accounts.escrow;
        require!(escrow.status == 1, ErrorCode::InvalidStatus);
        require!(escrow.token_type == 0, ErrorCode::InvalidParameter);
        require!(
            escrow.creator == ctx.accounts.creator.key(),
            ErrorCode::Unauthorized
        );

        let amount = escrow.amount;
        let escrow_key = ctx.accounts.escrow.key();
        let vault_bump = [ctx.bumps.vault];
        let vault_seeds = &[b"vault" as &[u8], escrow_key.as_ref(), &vault_bump];
        let signer_seeds: &[&[&[u8]]] = &[vault_seeds];

        system_program::transfer(
            CpiContext::new_with_signer(
                ctx.accounts.system_program.to_account_info(),
                system_program::Transfer {
                    from: ctx.accounts.vault.to_account_info(),
                    to: ctx.accounts.recipient.to_account_info(),
                },
                signer_seeds,
            ),
            amount,
        )?;

        let escrow = &mut ctx.accounts.escrow;
        escrow.status = 2; // Released

        Ok(())
    }

    pub fn release_escrow_spl(ctx: Context<ReleaseEscrowSpl>) -> Result<()> {
        let escrow = &ctx.accounts.escrow;
        require!(escrow.status == 1, ErrorCode::InvalidStatus);
        require!(escrow.token_type == 1, ErrorCode::InvalidParameter);
        require!(
            escrow.creator == ctx.accounts.creator.key(),
            ErrorCode::Unauthorized
        );
        require!(
            escrow.token_mint == ctx.accounts.token_mint.key(),
            ErrorCode::InvalidParameter
        );

        let amount = escrow.amount;
        let creator_key = escrow.creator;
        let nonce = escrow.nonce.clone();
        let escrow_bump = [escrow.bump];
        let escrow_seeds = &[
            b"escrow" as &[u8],
            creator_key.as_ref(),
            nonce.as_bytes(),
            &escrow_bump,
        ];
        let signer_seeds: &[&[&[u8]]] = &[escrow_seeds];

        token::transfer(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.escrow_token_account.to_account_info(),
                    to: ctx.accounts.recipient_token_account.to_account_info(),
                    authority: ctx.accounts.escrow.to_account_info(),
                },
                signer_seeds,
            ),
            amount,
        )?;

        let escrow = &mut ctx.accounts.escrow;
        escrow.status = 2; // Released

        Ok(())
    }

    pub fn refund_escrow_sol(ctx: Context<RefundEscrowSol>) -> Result<()> {
        let escrow = &ctx.accounts.escrow;
        require!(escrow.status == 1, ErrorCode::InvalidStatus);
        require!(escrow.token_type == 0, ErrorCode::InvalidParameter);
        require!(escrow.timeout_seconds > 0, ErrorCode::NoTimeout);

        let clock = Clock::get()?;
        let deadline = escrow
            .funded_at
            .checked_add(escrow.timeout_seconds)
            .ok_or(ErrorCode::MathOverflow)?;
        require!(clock.unix_timestamp >= deadline, ErrorCode::TimeoutNotElapsed);

        let amount = escrow.amount;
        let escrow_key = ctx.accounts.escrow.key();
        let vault_bump = [ctx.bumps.vault];
        let vault_seeds = &[b"vault" as &[u8], escrow_key.as_ref(), &vault_bump];
        let signer_seeds: &[&[&[u8]]] = &[vault_seeds];

        system_program::transfer(
            CpiContext::new_with_signer(
                ctx.accounts.system_program.to_account_info(),
                system_program::Transfer {
                    from: ctx.accounts.vault.to_account_info(),
                    to: ctx.accounts.creator.to_account_info(),
                },
                signer_seeds,
            ),
            amount,
        )?;

        let escrow = &mut ctx.accounts.escrow;
        escrow.status = 3; // Refunded

        Ok(())
    }

    pub fn refund_escrow_spl(ctx: Context<RefundEscrowSpl>) -> Result<()> {
        let escrow = &ctx.accounts.escrow;
        require!(escrow.status == 1, ErrorCode::InvalidStatus);
        require!(escrow.token_type == 1, ErrorCode::InvalidParameter);
        require!(escrow.timeout_seconds > 0, ErrorCode::NoTimeout);
        require!(
            escrow.token_mint == ctx.accounts.token_mint.key(),
            ErrorCode::InvalidParameter
        );

        let clock = Clock::get()?;
        let deadline = escrow
            .funded_at
            .checked_add(escrow.timeout_seconds)
            .ok_or(ErrorCode::MathOverflow)?;
        require!(clock.unix_timestamp >= deadline, ErrorCode::TimeoutNotElapsed);

        let amount = escrow.amount;
        let creator_key = escrow.creator;
        let nonce = escrow.nonce.clone();
        let escrow_bump = [escrow.bump];
        let escrow_seeds = &[
            b"escrow" as &[u8],
            creator_key.as_ref(),
            nonce.as_bytes(),
            &escrow_bump,
        ];
        let signer_seeds: &[&[&[u8]]] = &[escrow_seeds];

        token::transfer(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.escrow_token_account.to_account_info(),
                    to: ctx.accounts.creator_token_account.to_account_info(),
                    authority: ctx.accounts.escrow.to_account_info(),
                },
                signer_seeds,
            ),
            amount,
        )?;

        let escrow = &mut ctx.accounts.escrow;
        escrow.status = 3; // Refunded

        Ok(())
    }
}

// ============================================================
// Account Structs
// ============================================================

#[account]
pub struct Config {
    pub bump: u8,
    pub authority: Pubkey,
    pub is_active: bool,
    pub is_paused: bool,
    pub fee_bps: u16,
    pub reserve: Pubkey,
    pub version: u8,
}

impl Config {
    pub const LEN: usize = 1 + 32 + 1 + 1 + 2 + 32 + 1;
}

#[account]
pub struct EscrowState {
    pub creator: Pubkey,
    pub recipient: Pubkey,
    pub amount: u64,
    pub token_type: u8,
    pub token_mint: Pubkey,
    pub status: u8,
    pub timeout_seconds: i64,
    pub created_at: i64,
    pub funded_at: i64,
    pub memo: String,
    pub nonce: String,
    pub bump: u8,
}

impl EscrowState {
    // 32 + 32 + 8 + 1 + 32 + 1 + 8 + 8 + 8 + (4+100) + (4+32) + 1 = 271
    pub const LEN: usize = 32 + 32 + 8 + 1 + 32 + 1 + 8 + 8 + 8 + (4 + 100) + (4 + 32) + 1;
}

// ============================================================
// Context Structs
// ============================================================

#[derive(Accounts)]
pub struct InitializeConfig<'info> {
    #[account(
        init,
        seeds = [b"config", authority.key().as_ref()],
        bump,
        payer = authority,
        space = 8 + Config::LEN
    )]
    pub config: Account<'info, Config>,
    #[account(mut)]
    pub authority: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(recipient: Pubkey, amount: u64, token_type: u8, token_mint: Option<Pubkey>, timeout_seconds: Option<i64>, memo: String, nonce: String)]
pub struct CreateEscrow<'info> {
    #[account(
        init,
        seeds = [b"escrow", creator.key().as_ref(), nonce.as_bytes()],
        bump,
        payer = creator,
        space = 8 + EscrowState::LEN
    )]
    pub escrow: Account<'info, EscrowState>,
    #[account(mut)]
    pub creator: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct FundEscrowSol<'info> {
    #[account(
        mut,
        seeds = [b"escrow", escrow.creator.as_ref(), escrow.nonce.as_bytes()],
        bump = escrow.bump,
    )]
    pub escrow: Account<'info, EscrowState>,
    /// CHECK: Vault PDA that holds SOL, validated by seeds
    #[account(
        mut,
        seeds = [b"vault", escrow.key().as_ref()],
        bump,
    )]
    pub vault: SystemAccount<'info>,
    #[account(
        mut,
        constraint = creator.key() == escrow.creator @ ErrorCode::Unauthorized
    )]
    pub creator: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct FundEscrowSpl<'info> {
    #[account(
        mut,
        seeds = [b"escrow", escrow.creator.as_ref(), escrow.nonce.as_bytes()],
        bump = escrow.bump,
    )]
    pub escrow: Account<'info, EscrowState>,
    #[account(
        init_if_needed,
        payer = creator,
        associated_token::mint = token_mint,
        associated_token::authority = escrow,
    )]
    pub escrow_token_account: Account<'info, TokenAccount>,
    #[account(
        mut,
        constraint = creator_token_account.mint == token_mint.key() @ ErrorCode::InvalidParameter,
        constraint = creator_token_account.owner == creator.key() @ ErrorCode::Unauthorized,
    )]
    pub creator_token_account: Account<'info, TokenAccount>,
    #[account(
        constraint = token_mint.key() == escrow.token_mint @ ErrorCode::InvalidParameter
    )]
    pub token_mint: Account<'info, Mint>,
    #[account(
        mut,
        constraint = creator.key() == escrow.creator @ ErrorCode::Unauthorized
    )]
    pub creator: Signer<'info>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct ReleaseEscrowSol<'info> {
    #[account(
        mut,
        seeds = [b"escrow", escrow.creator.as_ref(), escrow.nonce.as_bytes()],
        bump = escrow.bump,
    )]
    pub escrow: Account<'info, EscrowState>,
    /// CHECK: Vault PDA that holds SOL, validated by seeds
    #[account(
        mut,
        seeds = [b"vault", escrow.key().as_ref()],
        bump,
    )]
    pub vault: SystemAccount<'info>,
    /// CHECK: Recipient validated against escrow.recipient
    #[account(
        mut,
        constraint = recipient.key() == escrow.recipient @ ErrorCode::Unauthorized
    )]
    pub recipient: UncheckedAccount<'info>,
    #[account(
        mut,
        constraint = creator.key() == escrow.creator @ ErrorCode::Unauthorized
    )]
    pub creator: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct ReleaseEscrowSpl<'info> {
    #[account(
        mut,
        seeds = [b"escrow", escrow.creator.as_ref(), escrow.nonce.as_bytes()],
        bump = escrow.bump,
    )]
    pub escrow: Account<'info, EscrowState>,
    #[account(
        mut,
        associated_token::mint = token_mint,
        associated_token::authority = escrow,
    )]
    pub escrow_token_account: Account<'info, TokenAccount>,
    #[account(
        init_if_needed,
        payer = creator,
        associated_token::mint = token_mint,
        associated_token::authority = recipient,
    )]
    pub recipient_token_account: Account<'info, TokenAccount>,
    #[account(
        constraint = token_mint.key() == escrow.token_mint @ ErrorCode::InvalidParameter
    )]
    pub token_mint: Account<'info, Mint>,
    /// CHECK: Recipient validated against escrow.recipient
    #[account(
        constraint = recipient.key() == escrow.recipient @ ErrorCode::Unauthorized
    )]
    pub recipient: UncheckedAccount<'info>,
    #[account(
        mut,
        constraint = creator.key() == escrow.creator @ ErrorCode::Unauthorized
    )]
    pub creator: Signer<'info>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct RefundEscrowSol<'info> {
    #[account(
        mut,
        seeds = [b"escrow", escrow.creator.as_ref(), escrow.nonce.as_bytes()],
        bump = escrow.bump,
    )]
    pub escrow: Account<'info, EscrowState>,
    /// CHECK: Vault PDA that holds SOL, validated by seeds
    #[account(
        mut,
        seeds = [b"vault", escrow.key().as_ref()],
        bump,
    )]
    pub vault: SystemAccount<'info>,
    /// CHECK: Creator validated against escrow.creator
    #[account(
        mut,
        constraint = creator.key() == escrow.creator @ ErrorCode::Unauthorized
    )]
    pub creator: UncheckedAccount<'info>,
    pub signer: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct RefundEscrowSpl<'info> {
    #[account(
        mut,
        seeds = [b"escrow", escrow.creator.as_ref(), escrow.nonce.as_bytes()],
        bump = escrow.bump,
    )]
    pub escrow: Account<'info, EscrowState>,
    #[account(
        mut,
        associated_token::mint = token_mint,
        associated_token::authority = escrow,
    )]
    pub escrow_token_account: Account<'info, TokenAccount>,
    #[account(
        init_if_needed,
        payer = signer,
        associated_token::mint = token_mint,
        associated_token::authority = creator,
    )]
    pub creator_token_account: Account<'info, TokenAccount>,
    #[account(
        constraint = token_mint.key() == escrow.token_mint @ ErrorCode::InvalidParameter
    )]
    pub token_mint: Account<'info, Mint>,
    /// CHECK: Creator validated against escrow.creator
    #[account(
        constraint = creator.key() == escrow.creator @ ErrorCode::Unauthorized
    )]
    pub creator: UncheckedAccount<'info>,
    #[account(mut)]
    pub signer: Signer<'info>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

// ============================================================
// Error Codes
// ============================================================

#[error_code]
pub enum ErrorCode {
    #[msg("Invalid escrow status for this operation")]
    InvalidStatus,
    #[msg("Timeout period has not elapsed yet")]
    TimeoutNotElapsed,
    #[msg("This escrow has no timeout set")]
    NoTimeout,
    #[msg("Unauthorized access")]
    Unauthorized,
    #[msg("Invalid amount")]
    InvalidAmount,
    #[msg("Memo exceeds 100 characters")]
    MemoTooLong,
    #[msg("Nonce exceeds 32 characters")]
    NonceTooLong,
    #[msg("Invalid parameter")]
    InvalidParameter,
    #[msg("Math overflow occurred")]
    MathOverflow,
    #[msg("Config is inactive")]
    ConfigInactive,
}
