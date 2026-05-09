import { Connection, PublicKey, SystemProgram, Transaction, LAMPORTS_PER_SOL } from "@solana/web3.js";
import {
  getAssociatedTokenAddress,
  createAssociatedTokenAccountInstruction,
  createTransferInstruction,
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import type { TokenType } from "./types";
import { USDC_MINT_DEVNET, TOKEN_DECIMALS } from "./types";

// For the hackathon demo we use a PDA-based escrow approach.
// The escrow "vault" is derived from a seed so we can track it.
// In production this would be a full Anchor program.
// For now, we use native Solana transactions for the demo.

const ESCROW_SEED_PREFIX = "solsend-escrow";

export function deriveEscrowPda(
  creator: PublicKey,
  recipient: PublicKey,
  nonce: string
): [PublicKey, number] {
  // Create a deterministic PDA-like address using a hash
  // For hackathon we use a simple keypair derived from seeds
  const encoder = new TextEncoder();
  const seeds = [
    encoder.encode(ESCROW_SEED_PREFIX),
    creator.toBytes(),
    recipient.toBytes(),
    encoder.encode(nonce),
  ];
  
  // Use a simple approach: generate a new keypair for the escrow vault
  // The vault address is stored in our link metadata
  return PublicKey.findProgramAddressSync(
    seeds,
    SystemProgram.programId
  );
}

export async function buildFundEscrowSolTx(
  connection: Connection,
  payer: PublicKey,
  escrowVault: PublicKey,
  amountSol: number
): Promise<Transaction> {
  const tx = new Transaction();
  const lamports = Math.floor(amountSol * LAMPORTS_PER_SOL);

  tx.add(
    SystemProgram.transfer({
      fromPubkey: payer,
      toPubkey: escrowVault,
      lamports,
    })
  );

  tx.feePayer = payer;
  const latestBlockhash = await connection.getLatestBlockhash();
  tx.recentBlockhash = latestBlockhash.blockhash;

  return tx;
}

export async function buildFundEscrowSplTx(
  connection: Connection,
  payer: PublicKey,
  recipientWallet: PublicKey,
  amount: number,
  mintAddress: PublicKey
): Promise<Transaction> {
  const tx = new Transaction();
  const decimals = TOKEN_DECIMALS.USDC;
  const tokenAmount = Math.floor(amount * Math.pow(10, decimals));

  const payerAta = await getAssociatedTokenAddress(mintAddress, payer);
  const recipientAta = await getAssociatedTokenAddress(mintAddress, recipientWallet);

  // Check if recipient ATA exists, if not create it
  const recipientAtaInfo = await connection.getAccountInfo(recipientAta);
  if (!recipientAtaInfo) {
    tx.add(
      createAssociatedTokenAccountInstruction(
        payer,
        recipientAta,
        recipientWallet,
        mintAddress,
        TOKEN_PROGRAM_ID,
        ASSOCIATED_TOKEN_PROGRAM_ID
      )
    );
  }

  tx.add(
    createTransferInstruction(
      payerAta,
      recipientAta,
      payer,
      tokenAmount,
      [],
      TOKEN_PROGRAM_ID
    )
  );

  tx.feePayer = payer;
  const latestBlockhash = await connection.getLatestBlockhash();
  tx.recentBlockhash = latestBlockhash.blockhash;

  return tx;
}

export async function buildReleaseSolTx(
  connection: Connection,
  payer: PublicKey,
  recipient: PublicKey,
  amountSol: number
): Promise<Transaction> {
  const tx = new Transaction();
  const lamports = Math.floor(amountSol * LAMPORTS_PER_SOL);

  tx.add(
    SystemProgram.transfer({
      fromPubkey: payer,
      toPubkey: recipient,
      lamports,
    })
  );

  tx.feePayer = payer;
  const latestBlockhash = await connection.getLatestBlockhash();
  tx.recentBlockhash = latestBlockhash.blockhash;

  return tx;
}

export async function buildReleaseSplTx(
  connection: Connection,
  payer: PublicKey,
  recipient: PublicKey,
  amount: number,
  mintAddress: PublicKey
): Promise<Transaction> {
  const tx = new Transaction();
  const decimals = TOKEN_DECIMALS.USDC;
  const tokenAmount = Math.floor(amount * Math.pow(10, decimals));

  const payerAta = await getAssociatedTokenAddress(mintAddress, payer);
  const recipientAta = await getAssociatedTokenAddress(mintAddress, recipient);

  const recipientAtaInfo = await connection.getAccountInfo(recipientAta);
  if (!recipientAtaInfo) {
    tx.add(
      createAssociatedTokenAccountInstruction(
        payer,
        recipientAta,
        recipient,
        mintAddress,
        TOKEN_PROGRAM_ID,
        ASSOCIATED_TOKEN_PROGRAM_ID
      )
    );
  }

  tx.add(
    createTransferInstruction(
      payerAta,
      recipientAta,
      payer,
      tokenAmount,
      [],
      TOKEN_PROGRAM_ID
    )
  );

  tx.feePayer = payer;
  const latestBlockhash = await connection.getLatestBlockhash();
  tx.recentBlockhash = latestBlockhash.blockhash;

  return tx;
}

export function getTokenMint(tokenType: TokenType): PublicKey | null {
  if (tokenType === "USDC") return USDC_MINT_DEVNET;
  return null;
}