/**
 * SolSend Escrow SDK
 * 
 * Production-ready TypeScript SDK for interacting with the SolSend Escrow program.
 * Supports SOL and SPL token escrows with timeout-based auto-refunds.
 */

import { BN, Program, AnchorProvider } from "@coral-xyz/anchor";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import {
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
} from "@solana/web3.js";
import IDL from "../idl/workspaceIDL.json";

// ===== Type Definitions =====

export interface EscrowStateData {
  creator: PublicKey;
  recipient: PublicKey;
  amount: BN;
  tokenType: number;
  tokenMint: PublicKey;
  status: number; // 0=Created, 1=Funded, 2=Released, 3=Refunded
  timeoutSeconds: BN;
  createdAt: BN;
  fundedAt: BN;
  memo: string;
  nonce: string;
  bump: number;
}

export interface CreateEscrowParams {
  recipient: PublicKey;
  amount: number; // In human-readable units (SOL or token amount)
  tokenType: number; // 0 = SOL, 1 = SPL
  tokenMint: PublicKey | null; // null for SOL
  timeoutSeconds: number | null; // null = no timeout
  memo: string;
  nonce: string;
}

export interface SDKResult<T> {
  success: boolean;
  data?: T;
  error?: string;
}

export const ESCROW_STATUS = {
  CREATED: 0,
  FUNDED: 1,
  RELEASED: 2,
  REFUNDED: 3,
} as const;

export const TOKEN_TYPE = {
  SOL: 0,
  SPL: 1,
} as const;

/**
 * SolSend Escrow SDK - Full interaction layer for the escrow program
 */
export class SolSendEscrowSDK {
  private readonly provider: AnchorProvider;
  private readonly program: Program<any>;

  constructor(provider: AnchorProvider) {
    this.provider = provider;
    this.program = new Program(IDL as any, this.provider);
  }

  // ===== Helpers =====

  private safeBN(value: any, defaultValue: number | string = 0): BN {
    if (value === null || value === undefined) return new BN(defaultValue);
    if (typeof value === "number") {
      if (isNaN(value) || !isFinite(value)) return new BN(defaultValue);
      return new BN(Math.floor(value).toString());
    }
    if (typeof value === "string") {
      const n = parseFloat(value);
      if (isNaN(n)) return new BN(defaultValue);
      return new BN(Math.floor(n).toString());
    }
    if (value instanceof BN) return value;
    return new BN(defaultValue);
  }

  private safeBNToNumber(value: any, defaultValue: number = 0): number {
    try {
      return value && typeof value.toNumber === "function" ? value.toNumber() : defaultValue;
    } catch {
      return defaultValue;
    }
  }

  private solToLamports(sol: number): BN {
    return this.safeBN(Math.floor(sol * LAMPORTS_PER_SOL));
  }

  private lamportsToSol(lamports: BN): number {
    return this.safeBNToNumber(lamports, 0) / LAMPORTS_PER_SOL;
  }

  private async testConnection(): Promise<boolean> {
    try {
      if (!this.provider?.connection) return false;
      const { value } = await this.provider.connection.getLatestBlockhashAndContext("finalized");
      return !!(value && value.blockhash);
    } catch {
      return false;
    }
  }

  /** Derive the escrow PDA from creator + nonce */
  getEscrowPDA(creator: PublicKey, nonce: string): [PublicKey, number] {
    return PublicKey.findProgramAddressSync(
      [Buffer.from("escrow"), creator.toBuffer(), Buffer.from(nonce)],
      this.program.programId
    );
  }

  /** Derive the vault PDA from escrow PDA */
  getVaultPDA(escrowPda: PublicKey): [PublicKey, number] {
    return PublicKey.findProgramAddressSync(
      [Buffer.from("vault"), escrowPda.toBuffer()],
      this.program.programId
    );
  }

  /** Generate a collision-resistant nonce (max 32 chars, URL-safe) */
  generateNonce(): string {
    // Use crypto.getRandomValues for true randomness — no timestamp component
    // that could collide when multiple escrows are created in the same millisecond.
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    return Array.from(bytes)
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("")
      .slice(0, 32);
  }

  // ===== Instructions =====

  /**
   * Create a new escrow
   */
  async createEscrow(params: CreateEscrowParams): Promise<SDKResult<{
    signature: string;
    escrowAddress: string;
    nonce: string;
  }>> {
    if (!this.provider.publicKey) return { success: false, error: "Wallet not connected" };

    try {
      if (!(await this.testConnection())) return { success: false, error: "Network unavailable" };

      if (!params.recipient) return { success: false, error: "Recipient required" };
      if (params.amount <= 0) return { success: false, error: "Amount must be positive" };
      if (params.memo.length > 100) return { success: false, error: "Memo too long (max 100)" };
      if (params.nonce.length > 32) return { success: false, error: "Nonce too long (max 32)" };

      const [escrowPda] = this.getEscrowPDA(this.provider.publicKey, params.nonce);
      console.debug("[createEscrow] nonce:", params.nonce, "escrowPda:", escrowPda.toBase58());

      // Pre-flight: ensure the derived PDA doesn't already exist on-chain.
      // If it does (e.g. from a prior session), the init will fail with 0x0.
      const existing = await this.provider.connection.getAccountInfo(escrowPda);
      if (existing !== null) {
        return {
          success: false,
          error: `Escrow account already exists on-chain (${escrowPda.toBase58().slice(0, 8)}…). Please try again — a new nonce will be generated.`,
        };
      }

      // Convert amount to smallest units
      let amountBN: BN;
      if (params.tokenType === TOKEN_TYPE.SOL) {
        amountBN = this.solToLamports(params.amount);
      } else {
        // SPL tokens - assume 6 decimals for USDC
        amountBN = this.safeBN(Math.floor(params.amount * 1e6));
      }

      const sig = await this.program.methods
        .createEscrow(
          params.recipient,
          amountBN,
          params.tokenType,
          params.tokenMint || null,
          params.timeoutSeconds ? new BN(params.timeoutSeconds) : null,
          params.memo,
          params.nonce
        )
        .accounts({
          escrow: escrowPda,
          creator: this.provider.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .rpc();

      return {
        success: true,
        data: {
          signature: sig,
          escrowAddress: escrowPda.toBase58(),
          nonce: params.nonce,
        },
      };
    } catch (error: any) {
      console.error("createEscrow error:", error);
      return { success: false, error: error?.message || "Failed to create escrow" };
    }
  }

  /**
   * Fund a SOL escrow
   */
  async fundEscrowSol(escrowAddress: PublicKey): Promise<SDKResult<{ signature: string }>> {
    if (!this.provider.publicKey) return { success: false, error: "Wallet not connected" };

    try {
      if (!(await this.testConnection())) return { success: false, error: "Network unavailable" };

      // Fetch escrow to validate
      const escrowAccount = await this.program.account.escrowState.fetch(escrowAddress);
      const [vaultPda] = this.getVaultPDA(escrowAddress);

      const sig = await this.program.methods
        .fundEscrowSol()
        .accounts({
          escrow: escrowAddress,
          vault: vaultPda,
          creator: this.provider.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .rpc();

      return { success: true, data: { signature: sig } };
    } catch (error: any) {
      console.error("fundEscrowSol error:", error);
      return { success: false, error: error?.message || "Failed to fund escrow" };
    }
  }

  /**
   * Fund an SPL token escrow
   */
  async fundEscrowSpl(escrowAddress: PublicKey): Promise<SDKResult<{ signature: string }>> {
    if (!this.provider.publicKey) return { success: false, error: "Wallet not connected" };

    try {
      if (!(await this.testConnection())) return { success: false, error: "Network unavailable" };

      const escrowAccount = await this.program.account.escrowState.fetch(escrowAddress);
      const tokenMint = escrowAccount.tokenMint;

      const creatorAta = getAssociatedTokenAddressSync(tokenMint, this.provider.publicKey);
      const escrowAta = getAssociatedTokenAddressSync(tokenMint, escrowAddress, true);

      const sig = await this.program.methods
        .fundEscrowSpl()
        .accounts({
          escrow: escrowAddress,
          escrowTokenAccount: escrowAta,
          creatorTokenAccount: creatorAta,
          tokenMint: tokenMint,
          creator: this.provider.publicKey,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .rpc();

      return { success: true, data: { signature: sig } };
    } catch (error: any) {
      console.error("fundEscrowSpl error:", error);
      return { success: false, error: error?.message || "Failed to fund SPL escrow" };
    }
  }

  /**
   * Release SOL escrow to recipient
   */
  async releaseEscrowSol(escrowAddress: PublicKey): Promise<SDKResult<{ signature: string }>> {
    if (!this.provider.publicKey) return { success: false, error: "Wallet not connected" };

    try {
      if (!(await this.testConnection())) return { success: false, error: "Network unavailable" };

      const escrowAccount = await this.program.account.escrowState.fetch(escrowAddress);
      const [vaultPda] = this.getVaultPDA(escrowAddress);

      const sig = await this.program.methods
        .releaseEscrowSol()
        .accounts({
          escrow: escrowAddress,
          vault: vaultPda,
          recipient: escrowAccount.recipient,
          creator: this.provider.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .rpc();

      return { success: true, data: { signature: sig } };
    } catch (error: any) {
      console.error("releaseEscrowSol error:", error);
      return { success: false, error: error?.message || "Failed to release escrow" };
    }
  }

  /**
   * Release SPL token escrow to recipient
   */
  async releaseEscrowSpl(escrowAddress: PublicKey): Promise<SDKResult<{ signature: string }>> {
    if (!this.provider.publicKey) return { success: false, error: "Wallet not connected" };

    try {
      if (!(await this.testConnection())) return { success: false, error: "Network unavailable" };

      const escrowAccount = await this.program.account.escrowState.fetch(escrowAddress);
      const tokenMint = escrowAccount.tokenMint;
      const recipient = escrowAccount.recipient;

      const escrowAta = getAssociatedTokenAddressSync(tokenMint, escrowAddress, true);
      const recipientAta = getAssociatedTokenAddressSync(tokenMint, recipient);

      const sig = await this.program.methods
        .releaseEscrowSpl()
        .accounts({
          escrow: escrowAddress,
          escrowTokenAccount: escrowAta,
          recipientTokenAccount: recipientAta,
          tokenMint: tokenMint,
          recipient: recipient,
          creator: this.provider.publicKey,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .rpc();

      return { success: true, data: { signature: sig } };
    } catch (error: any) {
      console.error("releaseEscrowSpl error:", error);
      return { success: false, error: error?.message || "Failed to release SPL escrow" };
    }
  }

  /**
   * Refund SOL escrow (timeout must have elapsed)
   */
  async refundEscrowSol(escrowAddress: PublicKey): Promise<SDKResult<{ signature: string }>> {
    if (!this.provider.publicKey) return { success: false, error: "Wallet not connected" };

    try {
      if (!(await this.testConnection())) return { success: false, error: "Network unavailable" };

      const escrowAccount = await this.program.account.escrowState.fetch(escrowAddress);
      const [vaultPda] = this.getVaultPDA(escrowAddress);

      const sig = await this.program.methods
        .refundEscrowSol()
        .accounts({
          escrow: escrowAddress,
          vault: vaultPda,
          creator: escrowAccount.creator,
          signer: this.provider.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .rpc();

      return { success: true, data: { signature: sig } };
    } catch (error: any) {
      console.error("refundEscrowSol error:", error);
      return { success: false, error: error?.message || "Failed to refund escrow" };
    }
  }

  /**
   * Refund SPL escrow (timeout must have elapsed)
   */
  async refundEscrowSpl(escrowAddress: PublicKey): Promise<SDKResult<{ signature: string }>> {
    if (!this.provider.publicKey) return { success: false, error: "Wallet not connected" };

    try {
      if (!(await this.testConnection())) return { success: false, error: "Network unavailable" };

      const escrowAccount = await this.program.account.escrowState.fetch(escrowAddress);
      const tokenMint = escrowAccount.tokenMint;
      const creator = escrowAccount.creator;

      const escrowAta = getAssociatedTokenAddressSync(tokenMint, escrowAddress, true);
      const creatorAta = getAssociatedTokenAddressSync(tokenMint, creator);

      const sig = await this.program.methods
        .refundEscrowSpl()
        .accounts({
          escrow: escrowAddress,
          escrowTokenAccount: escrowAta,
          creatorTokenAccount: creatorAta,
          tokenMint: tokenMint,
          creator: creator,
          signer: this.provider.publicKey,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .rpc();

      return { success: true, data: { signature: sig } };
    } catch (error: any) {
      console.error("refundEscrowSpl error:", error);
      return { success: false, error: error?.message || "Failed to refund SPL escrow" };
    }
  }

  // ===== Account Fetchers =====

  /**
   * Fetch a single escrow by address
   */
  async fetchEscrow(escrowAddress: PublicKey): Promise<SDKResult<EscrowStateData>> {
    try {
      const account = await this.program.account.escrowState.fetch(escrowAddress);
      return { success: true, data: account as EscrowStateData };
    } catch (error: any) {
      if (error?.message?.includes("Account does not exist")) {
        return { success: false, error: "Escrow not found" };
      }
      return { success: false, error: error?.message || "Failed to fetch escrow" };
    }
  }

  /**
   * Fetch all escrows (optionally filtered by creator)
   */
  async getAllEscrows(creator?: PublicKey): Promise<SDKResult<Array<{
    publicKey: PublicKey;
    account: EscrowStateData;
  }>>> {
    try {
      if (!(await this.testConnection())) return { success: false, error: "Network unavailable" };

      const allEscrows = await this.program.account.escrowState.all();
      if (!allEscrows?.length) return { success: true, data: [] };

      let filtered = allEscrows;
      if (creator) {
        filtered = allEscrows.filter(
          (e: any) =>
            e.account.creator?.toString() === creator.toString() ||
            e.account.recipient?.toString() === creator.toString()
        );
      }

      return {
        success: true,
        data: filtered.map((e: any) => ({
          publicKey: e.publicKey,
          account: e.account as EscrowStateData,
        })),
      };
    } catch (error: any) {
      if (error?.message?.includes("Account does not exist")) {
        return { success: true, data: [] };
      }
      return { success: false, error: error?.message || "Failed to fetch escrows" };
    }
  }

  /**
   * Get SOL balance for a wallet
   */
  async fetchSolBalance(account?: PublicKey): Promise<SDKResult<number>> {
    const target = account || this.provider.publicKey;
    if (!target) return { success: false, error: "No account" };

    try {
      const balance = await this.provider.connection.getBalance(target);
      return { success: true, data: balance / LAMPORTS_PER_SOL };
    } catch (error: any) {
      return { success: false, error: "Failed to fetch balance" };
    }
  }
}

export type { EscrowStateData as EscrowState };