import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { Workspace } from "../target/types/workspace";
import { expect } from "chai";
import {
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  createMint,
  mintTo,
  getAssociatedTokenAddress,
  getAccount,
  createAssociatedTokenAccount,
} from "@solana/spl-token";
import {
  PublicKey,
  SystemProgram,
  Keypair,
  LAMPORTS_PER_SOL,
} from "@solana/web3.js";
import { BN } from "@coral-xyz/anchor";

describe("solpay_escrow", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const program = anchor.workspace.workspace as Program<Workspace>;

  let authority: Keypair;
  let creator: Keypair;
  let recipient: Keypair;
  let configPDA: PublicKey;

  // SPL token vars
  let tokenMint: PublicKey;
  let creatorTokenAccount: PublicKey;

  const ESCROW_AMOUNT_SOL = new BN(0.5 * LAMPORTS_PER_SOL);
  const ESCROW_AMOUNT_SPL = new BN(1_000_000); // 1 USDC (6 decimals)

  before(async () => {
    authority = Keypair.generate();
    creator = Keypair.generate();
    recipient = Keypair.generate();

    // Fund all accounts
    await provider.connection.confirmTransaction(
      await provider.connection.requestAirdrop(
        authority.publicKey,
        100 * LAMPORTS_PER_SOL
      )
    );
    await provider.connection.confirmTransaction(
      await provider.connection.requestAirdrop(
        creator.publicKey,
        100 * LAMPORTS_PER_SOL
      )
    );
    await provider.connection.confirmTransaction(
      await provider.connection.requestAirdrop(
        recipient.publicKey,
        100 * LAMPORTS_PER_SOL
      )
    );

    [configPDA] = PublicKey.findProgramAddressSync(
      [Buffer.from("config"), authority.publicKey.toBuffer()],
      program.programId
    );

    // Create SPL token mint
    tokenMint = await createMint(
      provider.connection,
      authority,
      authority.publicKey,
      null,
      6
    );

    // Create creator's token account and mint tokens
    creatorTokenAccount = await createAssociatedTokenAccount(
      provider.connection,
      creator,
      tokenMint,
      creator.publicKey
    );

    await mintTo(
      provider.connection,
      authority,
      tokenMint,
      creatorTokenAccount,
      authority,
      100_000_000 // 100 tokens
    );
  });

  // ============================================================
  // 1. Initialize Config
  // ============================================================
  it("Initialize Config", async () => {
    await program.methods
      .initializeConfig(0, SystemProgram.programId)
      .accounts({
        config: configPDA,
        authority: authority.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .signers([authority])
      .rpc();

    const config = await program.account.config.fetch(configPDA);
    expect(config.isActive).to.be.true;
    expect(config.isPaused).to.be.false;
    expect(config.authority.toBase58()).to.equal(
      authority.publicKey.toBase58()
    );
    expect(config.version).to.equal(1);
  });

  // ============================================================
  // 2. Create SOL Escrow
  // ============================================================
  it("Create SOL Escrow", async () => {
    const nonce = "sol-pay-001";
    const memo = "Payment for freelance work";

    const [escrowPDA] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("escrow"),
        creator.publicKey.toBuffer(),
        Buffer.from(nonce),
      ],
      program.programId
    );

    await program.methods
      .createEscrow(
        recipient.publicKey,
        ESCROW_AMOUNT_SOL,
        0, // SOL
        null,
        new BN(3600), // 1 hour timeout
        memo,
        nonce
      )
      .accounts({
        escrow: escrowPDA,
        creator: creator.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .signers([creator])
      .rpc();

    const escrow = await program.account.escrowState.fetch(escrowPDA);
    expect(escrow.creator.toBase58()).to.equal(creator.publicKey.toBase58());
    expect(escrow.recipient.toBase58()).to.equal(
      recipient.publicKey.toBase58()
    );
    expect(escrow.amount.toString()).to.equal(ESCROW_AMOUNT_SOL.toString());
    expect(escrow.tokenType).to.equal(0);
    expect(escrow.status).to.equal(0); // Created
    expect(escrow.timeoutSeconds.toNumber()).to.equal(3600);
    expect(escrow.memo).to.equal(memo);
    expect(escrow.nonce).to.equal(nonce);
  });

  // ============================================================
  // 3. Fund SOL Escrow
  // ============================================================
  it("Fund SOL Escrow", async () => {
    const nonce = "sol-pay-001";

    const [escrowPDA] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("escrow"),
        creator.publicKey.toBuffer(),
        Buffer.from(nonce),
      ],
      program.programId
    );

    const [vaultPDA] = PublicKey.findProgramAddressSync(
      [Buffer.from("vault"), escrowPDA.toBuffer()],
      program.programId
    );

    await program.methods
      .fundEscrowSol()
      .accounts({
        escrow: escrowPDA,
        vault: vaultPDA,
        creator: creator.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .signers([creator])
      .rpc();

    const escrow = await program.account.escrowState.fetch(escrowPDA);
    expect(escrow.status).to.equal(1); // Funded
    expect(escrow.fundedAt.toNumber()).to.be.greaterThan(0);

    const vaultBalance = await provider.connection.getBalance(vaultPDA);
    expect(vaultBalance).to.be.greaterThanOrEqual(Number(ESCROW_AMOUNT_SOL));
  });

  // ============================================================
  // 4. Release SOL Escrow
  // ============================================================
  it("Release SOL Escrow to Recipient", async () => {
    const nonce = "sol-pay-001";

    const [escrowPDA] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("escrow"),
        creator.publicKey.toBuffer(),
        Buffer.from(nonce),
      ],
      program.programId
    );

    const [vaultPDA] = PublicKey.findProgramAddressSync(
      [Buffer.from("vault"), escrowPDA.toBuffer()],
      program.programId
    );

    const recipientBefore = await provider.connection.getBalance(
      recipient.publicKey
    );

    await program.methods
      .releaseEscrowSol()
      .accounts({
        escrow: escrowPDA,
        vault: vaultPDA,
        recipient: recipient.publicKey,
        creator: creator.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .signers([creator])
      .rpc();

    const escrow = await program.account.escrowState.fetch(escrowPDA);
    expect(escrow.status).to.equal(2); // Released

    const recipientAfter = await provider.connection.getBalance(
      recipient.publicKey
    );
    expect(recipientAfter - recipientBefore).to.be.greaterThanOrEqual(
      Number(ESCROW_AMOUNT_SOL)
    );
  });

  // ============================================================
  // 5. Create + Fund + Release SOL Escrow (full flow)
  // ============================================================
  it("Full SOL Escrow Flow (create -> fund -> release)", async () => {
    const nonce = "sol-full-flow";
    const memo = "Full flow test";

    const [escrowPDA] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("escrow"),
        creator.publicKey.toBuffer(),
        Buffer.from(nonce),
      ],
      program.programId
    );

    const [vaultPDA] = PublicKey.findProgramAddressSync(
      [Buffer.from("vault"), escrowPDA.toBuffer()],
      program.programId
    );

    // Create
    await program.methods
      .createEscrow(
        recipient.publicKey,
        ESCROW_AMOUNT_SOL,
        0,
        null,
        null, // no timeout
        memo,
        nonce
      )
      .accounts({
        escrow: escrowPDA,
        creator: creator.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .signers([creator])
      .rpc();

    // Fund
    await program.methods
      .fundEscrowSol()
      .accounts({
        escrow: escrowPDA,
        vault: vaultPDA,
        creator: creator.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .signers([creator])
      .rpc();

    // Release
    const recipientBefore = await provider.connection.getBalance(
      recipient.publicKey
    );

    await program.methods
      .releaseEscrowSol()
      .accounts({
        escrow: escrowPDA,
        vault: vaultPDA,
        recipient: recipient.publicKey,
        creator: creator.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .signers([creator])
      .rpc();

    const escrow = await program.account.escrowState.fetch(escrowPDA);
    expect(escrow.status).to.equal(2);

    const recipientAfter = await provider.connection.getBalance(
      recipient.publicKey
    );
    expect(recipientAfter - recipientBefore).to.be.greaterThanOrEqual(
      Number(ESCROW_AMOUNT_SOL)
    );
  });

  // ============================================================
  // 6. Create SPL Escrow
  // ============================================================
  it("Create SPL Token Escrow", async () => {
    const nonce = "spl-pay-001";
    const memo = "USDC payment for design";

    const [escrowPDA] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("escrow"),
        creator.publicKey.toBuffer(),
        Buffer.from(nonce),
      ],
      program.programId
    );

    await program.methods
      .createEscrow(
        recipient.publicKey,
        ESCROW_AMOUNT_SPL,
        1, // SPL
        tokenMint,
        new BN(7200), // 2 hour timeout
        memo,
        nonce
      )
      .accounts({
        escrow: escrowPDA,
        creator: creator.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .signers([creator])
      .rpc();

    const escrow = await program.account.escrowState.fetch(escrowPDA);
    expect(escrow.tokenType).to.equal(1);
    expect(escrow.tokenMint.toBase58()).to.equal(tokenMint.toBase58());
    expect(escrow.amount.toString()).to.equal(ESCROW_AMOUNT_SPL.toString());
    expect(escrow.status).to.equal(0);
  });

  // ============================================================
  // 7. Fund SPL Escrow
  // ============================================================
  it("Fund SPL Token Escrow", async () => {
    const nonce = "spl-pay-001";

    const [escrowPDA] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("escrow"),
        creator.publicKey.toBuffer(),
        Buffer.from(nonce),
      ],
      program.programId
    );

    const escrowTokenAccount = await getAssociatedTokenAddress(
      tokenMint,
      escrowPDA,
      true // allowOwnerOffCurve for PDA
    );

    await program.methods
      .fundEscrowSpl()
      .accounts({
        escrow: escrowPDA,
        escrowTokenAccount: escrowTokenAccount,
        creatorTokenAccount: creatorTokenAccount,
        tokenMint: tokenMint,
        creator: creator.publicKey,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .signers([creator])
      .rpc();

    const escrow = await program.account.escrowState.fetch(escrowPDA);
    expect(escrow.status).to.equal(1); // Funded

    const tokenData = await getAccount(
      provider.connection,
      escrowTokenAccount
    );
    expect(Number(tokenData.amount)).to.equal(Number(ESCROW_AMOUNT_SPL));
  });

  // ============================================================
  // 8. Release SPL Escrow
  // ============================================================
  it("Release SPL Token Escrow to Recipient", async () => {
    const nonce = "spl-pay-001";

    const [escrowPDA] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("escrow"),
        creator.publicKey.toBuffer(),
        Buffer.from(nonce),
      ],
      program.programId
    );

    const escrowTokenAccount = await getAssociatedTokenAddress(
      tokenMint,
      escrowPDA,
      true
    );

    const recipientTokenAccount = await getAssociatedTokenAddress(
      tokenMint,
      recipient.publicKey
    );

    await program.methods
      .releaseEscrowSpl()
      .accounts({
        escrow: escrowPDA,
        escrowTokenAccount: escrowTokenAccount,
        recipientTokenAccount: recipientTokenAccount,
        tokenMint: tokenMint,
        recipient: recipient.publicKey,
        creator: creator.publicKey,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .signers([creator])
      .rpc();

    const escrow = await program.account.escrowState.fetch(escrowPDA);
    expect(escrow.status).to.equal(2); // Released

    const tokenData = await getAccount(
      provider.connection,
      recipientTokenAccount
    );
    expect(Number(tokenData.amount)).to.equal(Number(ESCROW_AMOUNT_SPL));
  });

  // ============================================================
  // 9. Validation: Cannot fund already funded escrow
  // ============================================================
  it("Fails to fund an already released escrow", async () => {
    const nonce = "sol-pay-001"; // Already released

    const [escrowPDA] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("escrow"),
        creator.publicKey.toBuffer(),
        Buffer.from(nonce),
      ],
      program.programId
    );

    const [vaultPDA] = PublicKey.findProgramAddressSync(
      [Buffer.from("vault"), escrowPDA.toBuffer()],
      program.programId
    );

    try {
      await program.methods
        .fundEscrowSol()
        .accounts({
          escrow: escrowPDA,
          vault: vaultPDA,
          creator: creator.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .signers([creator])
        .rpc();
      expect.fail("Should have thrown");
    } catch (error: any) {
      expect(error.message).to.include("InvalidStatus");
    }
  });

  // ============================================================
  // 10. Validation: Cannot release unfunded escrow
  // ============================================================
  it("Fails to release an unfunded escrow", async () => {
    const nonce = "sol-unfunded";
    const memo = "Unfunded test";

    const [escrowPDA] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("escrow"),
        creator.publicKey.toBuffer(),
        Buffer.from(nonce),
      ],
      program.programId
    );

    const [vaultPDA] = PublicKey.findProgramAddressSync(
      [Buffer.from("vault"), escrowPDA.toBuffer()],
      program.programId
    );

    // Create but don't fund
    await program.methods
      .createEscrow(
        recipient.publicKey,
        ESCROW_AMOUNT_SOL,
        0,
        null,
        null,
        memo,
        nonce
      )
      .accounts({
        escrow: escrowPDA,
        creator: creator.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .signers([creator])
      .rpc();

    try {
      await program.methods
        .releaseEscrowSol()
        .accounts({
          escrow: escrowPDA,
          vault: vaultPDA,
          recipient: recipient.publicKey,
          creator: creator.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .signers([creator])
        .rpc();
      expect.fail("Should have thrown");
    } catch (error: any) {
      expect(error.message).to.include("InvalidStatus");
    }
  });

  // ============================================================
  // 11. Validation: Unauthorized user cannot fund
  // ============================================================
  it("Fails when unauthorized user tries to fund", async () => {
    const nonce = "sol-unauth";
    const memo = "Unauth test";
    const unauthorized = Keypair.generate();

    await provider.connection.confirmTransaction(
      await provider.connection.requestAirdrop(
        unauthorized.publicKey,
        10 * LAMPORTS_PER_SOL
      )
    );

    const [escrowPDA] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("escrow"),
        creator.publicKey.toBuffer(),
        Buffer.from(nonce),
      ],
      program.programId
    );

    const [vaultPDA] = PublicKey.findProgramAddressSync(
      [Buffer.from("vault"), escrowPDA.toBuffer()],
      program.programId
    );

    await program.methods
      .createEscrow(
        recipient.publicKey,
        ESCROW_AMOUNT_SOL,
        0,
        null,
        null,
        memo,
        nonce
      )
      .accounts({
        escrow: escrowPDA,
        creator: creator.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .signers([creator])
      .rpc();

    try {
      await program.methods
        .fundEscrowSol()
        .accounts({
          escrow: escrowPDA,
          vault: vaultPDA,
          creator: unauthorized.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .signers([unauthorized])
        .rpc();
      expect.fail("Should have thrown");
    } catch (error: any) {
      expect(error.message).to.include("Unauthorized");
    }
  });

  // ============================================================
  // 12. Validation: Memo too long
  // ============================================================
  it("Fails when memo exceeds 100 characters", async () => {
    const nonce = "sol-memo-long";
    const longMemo = "A".repeat(101);

    const [escrowPDA] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("escrow"),
        creator.publicKey.toBuffer(),
        Buffer.from(nonce),
      ],
      program.programId
    );

    try {
      await program.methods
        .createEscrow(
          recipient.publicKey,
          ESCROW_AMOUNT_SOL,
          0,
          null,
          null,
          longMemo,
          nonce
        )
        .accounts({
          escrow: escrowPDA,
          creator: creator.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .signers([creator])
        .rpc();
      expect.fail("Should have thrown");
    } catch (error: any) {
      expect(error.message).to.include("MemoTooLong");
    }
  });

  // ============================================================
  // 13. Validation: Nonce too long
  // ============================================================
  it("Fails when nonce exceeds 32 characters", async () => {
    const nonce = "A".repeat(33);

    // PDA seed max is 32 bytes, so findProgramAddressSync will throw
    // OR the program will reject it. Either way it should fail.
    try {
      const [escrowPDA] = PublicKey.findProgramAddressSync(
        [
          Buffer.from("escrow"),
          creator.publicKey.toBuffer(),
          Buffer.from(nonce),
        ],
        program.programId
      );

      await program.methods
        .createEscrow(
          recipient.publicKey,
          ESCROW_AMOUNT_SOL,
          0,
          null,
          null,
          "Test memo",
          nonce
        )
        .accounts({
          escrow: escrowPDA,
          creator: creator.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .signers([creator])
        .rpc();
      expect.fail("Should have thrown");
    } catch (error: any) {
      // Either client-side seed length error or program-side NonceTooLong
      const msg = error.message || error.toString();
      const isExpectedError =
        msg.includes("NonceTooLong") ||
        msg.includes("Max seed length exceeded") ||
        msg.includes("seed");
      expect(isExpectedError).to.be.true;
    }
  });

  // ============================================================
  // 14. Validation: Zero amount
  // ============================================================
  it("Fails when amount is zero", async () => {
    const nonce = "sol-zero-amt";

    const [escrowPDA] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("escrow"),
        creator.publicKey.toBuffer(),
        Buffer.from(nonce),
      ],
      program.programId
    );

    try {
      await program.methods
        .createEscrow(
          recipient.publicKey,
          new BN(0),
          0,
          null,
          null,
          "Zero amount test",
          nonce
        )
        .accounts({
          escrow: escrowPDA,
          creator: creator.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .signers([creator])
        .rpc();
      expect.fail("Should have thrown");
    } catch (error: any) {
      expect(error.message).to.include("InvalidAmount");
    }
  });

  // ============================================================
  // 15. Refund SOL: Fails when no timeout set
  // ============================================================
  it("Fails to refund SOL escrow with no timeout", async () => {
    const nonce = "sol-no-timeout";
    const memo = "No timeout test";

    const [escrowPDA] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("escrow"),
        creator.publicKey.toBuffer(),
        Buffer.from(nonce),
      ],
      program.programId
    );

    const [vaultPDA] = PublicKey.findProgramAddressSync(
      [Buffer.from("vault"), escrowPDA.toBuffer()],
      program.programId
    );

    // Create with no timeout
    await program.methods
      .createEscrow(
        recipient.publicKey,
        ESCROW_AMOUNT_SOL,
        0,
        null,
        null, // no timeout
        memo,
        nonce
      )
      .accounts({
        escrow: escrowPDA,
        creator: creator.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .signers([creator])
      .rpc();

    // Fund
    await program.methods
      .fundEscrowSol()
      .accounts({
        escrow: escrowPDA,
        vault: vaultPDA,
        creator: creator.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .signers([creator])
      .rpc();

    try {
      await program.methods
        .refundEscrowSol()
        .accounts({
          escrow: escrowPDA,
          vault: vaultPDA,
          creator: creator.publicKey,
          signer: creator.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .signers([creator])
        .rpc();
      expect.fail("Should have thrown");
    } catch (error: any) {
      expect(error.message).to.include("NoTimeout");
    }
  });

  // ============================================================
  // 16. Refund SOL: Fails when timeout not elapsed
  // ============================================================
  it("Fails to refund SOL escrow before timeout", async () => {
    const nonce = "sol-timeout-early";
    const memo = "Timeout early test";

    const [escrowPDA] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("escrow"),
        creator.publicKey.toBuffer(),
        Buffer.from(nonce),
      ],
      program.programId
    );

    const [vaultPDA] = PublicKey.findProgramAddressSync(
      [Buffer.from("vault"), escrowPDA.toBuffer()],
      program.programId
    );

    // Create with long timeout
    await program.methods
      .createEscrow(
        recipient.publicKey,
        ESCROW_AMOUNT_SOL,
        0,
        null,
        new BN(999999), // very long timeout
        memo,
        nonce
      )
      .accounts({
        escrow: escrowPDA,
        creator: creator.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .signers([creator])
      .rpc();

    // Fund
    await program.methods
      .fundEscrowSol()
      .accounts({
        escrow: escrowPDA,
        vault: vaultPDA,
        creator: creator.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .signers([creator])
      .rpc();

    try {
      await program.methods
        .refundEscrowSol()
        .accounts({
          escrow: escrowPDA,
          vault: vaultPDA,
          creator: creator.publicKey,
          signer: creator.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .signers([creator])
        .rpc();
      expect.fail("Should have thrown");
    } catch (error: any) {
      expect(error.message).to.include("TimeoutNotElapsed");
    }
  });

  // ============================================================
  // 17. Cannot double-release
  // ============================================================
  it("Fails to release an already released escrow", async () => {
    const nonce = "sol-full-flow"; // Already released in test 5

    const [escrowPDA] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("escrow"),
        creator.publicKey.toBuffer(),
        Buffer.from(nonce),
      ],
      program.programId
    );

    const [vaultPDA] = PublicKey.findProgramAddressSync(
      [Buffer.from("vault"), escrowPDA.toBuffer()],
      program.programId
    );

    try {
      await program.methods
        .releaseEscrowSol()
        .accounts({
          escrow: escrowPDA,
          vault: vaultPDA,
          recipient: recipient.publicKey,
          creator: creator.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .signers([creator])
        .rpc();
      expect.fail("Should have thrown");
    } catch (error: any) {
      expect(error.message).to.include("InvalidStatus");
    }
  });

  // ============================================================
  // 18. Full SPL flow (create -> fund -> release)
  // ============================================================
  it("Full SPL Token Escrow Flow (create -> fund -> release)", async () => {
    const nonce = "spl-full-flow";
    const memo = "Full SPL flow";

    const [escrowPDA] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("escrow"),
        creator.publicKey.toBuffer(),
        Buffer.from(nonce),
      ],
      program.programId
    );

    const escrowTokenAccount = await getAssociatedTokenAddress(
      tokenMint,
      escrowPDA,
      true
    );

    const recipientTokenAccount = await getAssociatedTokenAddress(
      tokenMint,
      recipient.publicKey
    );

    // Create
    await program.methods
      .createEscrow(
        recipient.publicKey,
        ESCROW_AMOUNT_SPL,
        1,
        tokenMint,
        null,
        memo,
        nonce
      )
      .accounts({
        escrow: escrowPDA,
        creator: creator.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .signers([creator])
      .rpc();

    // Fund
    await program.methods
      .fundEscrowSpl()
      .accounts({
        escrow: escrowPDA,
        escrowTokenAccount: escrowTokenAccount,
        creatorTokenAccount: creatorTokenAccount,
        tokenMint: tokenMint,
        creator: creator.publicKey,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .signers([creator])
      .rpc();

    let escrow = await program.account.escrowState.fetch(escrowPDA);
    expect(escrow.status).to.equal(1);

    // Release
    await program.methods
      .releaseEscrowSpl()
      .accounts({
        escrow: escrowPDA,
        escrowTokenAccount: escrowTokenAccount,
        recipientTokenAccount: recipientTokenAccount,
        tokenMint: tokenMint,
        recipient: recipient.publicKey,
        creator: creator.publicKey,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .signers([creator])
      .rpc();

    escrow = await program.account.escrowState.fetch(escrowPDA);
    expect(escrow.status).to.equal(2);

    // Recipient already had tokens from test 8, so check total
    const tokenData = await getAccount(
      provider.connection,
      recipientTokenAccount
    );
    expect(Number(tokenData.amount)).to.equal(
      Number(ESCROW_AMOUNT_SPL) * 2
    ); // from test 8 + this test
  });

  // ============================================================
  // 19. Create escrow with max length memo and nonce
  // ============================================================
  it("Creates escrow with max length memo (100) and nonce (32)", async () => {
    const nonce = "B".repeat(32);
    const memo = "C".repeat(100);

    const [escrowPDA] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("escrow"),
        creator.publicKey.toBuffer(),
        Buffer.from(nonce),
      ],
      program.programId
    );

    await program.methods
      .createEscrow(
        recipient.publicKey,
        ESCROW_AMOUNT_SOL,
        0,
        null,
        null,
        memo,
        nonce
      )
      .accounts({
        escrow: escrowPDA,
        creator: creator.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .signers([creator])
      .rpc();

    const escrow = await program.account.escrowState.fetch(escrowPDA);
    expect(escrow.memo.length).to.equal(100);
    expect(escrow.nonce.length).to.equal(32);
  });

  // ============================================================
  // 20. Unauthorized release attempt
  // ============================================================
  it("Fails when unauthorized user tries to release", async () => {
    const nonce = "sol-unauth-release";
    const memo = "Unauth release test";
    const unauthorized = Keypair.generate();

    await provider.connection.confirmTransaction(
      await provider.connection.requestAirdrop(
        unauthorized.publicKey,
        10 * LAMPORTS_PER_SOL
      )
    );

    const [escrowPDA] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("escrow"),
        creator.publicKey.toBuffer(),
        Buffer.from(nonce),
      ],
      program.programId
    );

    const [vaultPDA] = PublicKey.findProgramAddressSync(
      [Buffer.from("vault"), escrowPDA.toBuffer()],
      program.programId
    );

    // Create and fund
    await program.methods
      .createEscrow(
        recipient.publicKey,
        ESCROW_AMOUNT_SOL,
        0,
        null,
        null,
        memo,
        nonce
      )
      .accounts({
        escrow: escrowPDA,
        creator: creator.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .signers([creator])
      .rpc();

    await program.methods
      .fundEscrowSol()
      .accounts({
        escrow: escrowPDA,
        vault: vaultPDA,
        creator: creator.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .signers([creator])
      .rpc();

    try {
      await program.methods
        .releaseEscrowSol()
        .accounts({
          escrow: escrowPDA,
          vault: vaultPDA,
          recipient: recipient.publicKey,
          creator: unauthorized.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .signers([unauthorized])
        .rpc();
      expect.fail("Should have thrown");
    } catch (error: any) {
      expect(error.message).to.include("Unauthorized");
    }
  });
});