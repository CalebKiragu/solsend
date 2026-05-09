import { PublicKey } from "@solana/web3.js";

/** Payment link type */
export type LinkType = "one-time" | "recurring" | "escrow";

/** Status for all link types */
export type LinkStatus =
  | "active"           // Recurring: accepting payments. One-time: awaiting payment
  | "completed"        // One-time: paid. Escrow: released
  | "pending"          // Escrow: created on-chain, not yet funded
  | "funded"           // Escrow: funded, awaiting release
  | "released"         // Escrow: released to recipient
  | "refunded"         // Escrow: refunded to creator
  | "appealed"         // Escrow: suspended by either party, awaiting arbitration
  | "expired";         // Link has expired (any type)

/** Escrow user role relative to a link */
export type EscrowRole = "payer" | "recipient" | "none";

/** Determine the connected wallet's role on an escrow link */
export function getEscrowRole(link: PaymentLink, walletAddress: string | null): EscrowRole {
  if (!walletAddress) return "none";
  if (walletAddress === link.creator) return "payer";
  if (walletAddress === link.recipient) return "recipient";
  return "none";
}

export type TokenType = "SOL" | "USDC";

/** A single payment received on a link */
export interface PaymentRecord {
  id: string;
  payer: string;
  amount: number;
  tokenType: TokenType;
  txSignature: string;
  paidAt: string;
}

export interface PaymentLink {
  id: string;
  type: LinkType;
  creator: string;
  recipient: string;
  amount: number;           // Fixed amount (0 = custom/any amount for recurring)
  allowCustomAmount: boolean; // If true, payer can enter any amount (recurring only)
  tokenType: TokenType;
  tokenMint: string | null;
  status: LinkStatus;
  memo: string;
  createdAt: string;
  linkUrl: string;

  // Expiry (null = never expires, infinite link)
  expiresAt: string | null;

  // Recurring fields
  payments: PaymentRecord[];  // History of payments received
  totalReceived: number;      // Sum of all payments

  // Escrow-specific fields (null for direct)
  escrowPda: string | null;
  nonce: string | null;
  timeoutSeconds: number | null;
  fundedAt: string | null;
  releasedAt: string | null;
  refundedAt: string | null;
  appealedAt: string | null;
  appealedBy: string | null;

  // One-time direct fields
  paidAt: string | null;
  txSignature: string | null;
}

export interface CreateLinkParams {
  type: LinkType;
  recipient: string;
  amount: number;
  allowCustomAmount: boolean;
  tokenType: TokenType;
  memo: string;
  expiresAt: string | null;
  // Escrow only
  timeoutSeconds?: number | null;
}

export const USDC_MINT_DEVNET = new PublicKey("4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU");

export const TOKEN_LABELS: Record<TokenType, string> = {
  SOL: "SOL",
  USDC: "USDC",
};

export const TOKEN_DECIMALS: Record<TokenType, number> = {
  SOL: 9,
  USDC: 6,
};

export function shortenAddress(address: string, chars = 4): string {
  return `${address.slice(0, chars)}...${address.slice(-chars)}`;
}

export function lamportsToSol(lamports: number): number {
  return lamports / 1e9;
}

export function solToLamports(sol: number): number {
  return Math.floor(sol * 1e9);
}

export function formatCountdown(seconds: number): string {
  if (seconds <= 0) return "Expired";
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (d > 0) return `${d}d ${h}h ${m}m`;
  if (h > 0) return `${h}h ${m}m ${s}s`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

export function isLinkExpired(link: PaymentLink): boolean {
  if (!link.expiresAt) return false;
  return new Date(link.expiresAt).getTime() < Date.now();
}

export function getExpiryLabel(expiresAt: string | null): string {
  if (!expiresAt) return "Never";
  const diff = new Date(expiresAt).getTime() - Date.now();
  if (diff <= 0) return "Expired";
  return formatCountdown(Math.floor(diff / 1000));
}

export function getTypeLabel(type: LinkType): string {
  switch (type) {
    case "one-time": return "One-time";
    case "recurring": return "Recurring";
    case "escrow": return "Escrow";
  }
}

export function getTypeColor(type: LinkType): string {
  switch (type) {
    case "one-time": return "type-onetime";
    case "recurring": return "type-recurring";
    case "escrow": return "type-escrow";
  }
}

export function getStatusColor(status: LinkStatus): string {
  switch (status) {
    case "active":
      return "status-active";
    case "pending":
      return "status-pending";
    case "funded":
      return "status-funded";
    case "completed":
    case "released":
      return "status-released";
    case "appealed":
      return "status-appealed";
    case "refunded":
    case "expired":
      return "status-refunded";
    default:
      return "";
  }
}

export function getStatusLabel(status: LinkStatus): string {
  switch (status) {
    case "active": return "Active";
    case "completed": return "Completed";
    case "pending": return "Pending";
    case "funded": return "Funded";
    case "released": return "Released";
    case "refunded": return "Refunded";
    case "appealed": return "Under Appeal";
    case "expired": return "Expired";
    default: return status;
  }
}

/** Check if the escrow timeout has elapsed (auto-refund eligible) */
export function isEscrowTimedOut(link: PaymentLink): boolean {
  if (link.type !== "escrow" || link.status !== "funded") return false;
  if (!link.fundedAt || !link.timeoutSeconds) return false;
  const deadline = new Date(link.fundedAt).getTime() + link.timeoutSeconds * 1000;
  return Date.now() >= deadline;
}