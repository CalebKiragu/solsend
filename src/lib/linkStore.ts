import type { PaymentLink, CreateLinkParams, LinkStatus, PaymentRecord } from "./types";
import { supabase, isSupabaseEnabled } from "./supabase";

const STORAGE_KEY = "solsend_links";

// ─── Helpers ────────────────────────────────────────────────────────────────

export function getOrigin(): string {
  try {
    if (typeof window !== "undefined") {
      return window.location.origin || "";
    }
  } catch {
    // SecurityError in sandboxed cross-origin iframes
  }
  return "";
}

/** Safe wrapper for navigator.clipboard (falls back to noop) */
export function safeClipboardWrite(text: string): Promise<void> {
  try {
    if (navigator?.clipboard?.writeText) {
      return navigator.clipboard.writeText(text);
    }
  } catch {
    // ignore
  }
  return Promise.resolve();
}

export function generateLinkId(): string {
  return crypto.randomUUID().replace(/-/g, "").slice(0, 12);
}

export function generatePaymentId(): string {
  return crypto.randomUUID().replace(/-/g, "").slice(0, 8);
}

// ─── localStorage cache ──────────────────────────────────────────────────────

function cacheLoad(): PaymentLink[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch {
    // ignore
  }
  return [];
}

function cacheSave(links: PaymentLink[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(links));
  } catch {
    // ignore — storage quota exceeded etc.
  }
}

function cacheUpsert(link: PaymentLink) {
  const links = cacheLoad();
  const idx = links.findIndex((l) => l.id === link.id);
  if (idx === -1) {
    cacheSave([link, ...links]);
  } else {
    links[idx] = link;
    cacheSave(links);
  }
}

// ─── Supabase row ↔ PaymentLink mapping ─────────────────────────────────────

// Supabase stores payments as a JSONB column on the link row.
// Column names use snake_case to match the SQL schema below.

function rowToLink(row: Record<string, unknown>): PaymentLink {
  return {
    id: row.id as string,
    type: row.type as PaymentLink["type"],
    creator: row.creator as string,
    recipient: row.recipient as string,
    amount: row.amount as number,
    allowCustomAmount: row.allow_custom_amount as boolean,
    tokenType: row.token_type as PaymentLink["tokenType"],
    tokenMint: (row.token_mint as string) ?? null,
    status: row.status as LinkStatus,
    memo: (row.memo as string) ?? "",
    createdAt: row.created_at as string,
    linkUrl: row.link_url as string,
    expiresAt: (row.expires_at as string) ?? null,
    payments: (row.payments as PaymentRecord[]) ?? [],
    totalReceived: (row.total_received as number) ?? 0,
    escrowPda: (row.escrow_pda as string) ?? null,
    nonce: (row.nonce as string) ?? null,
    timeoutSeconds: (row.timeout_seconds as number) ?? null,
    fundedAt: (row.funded_at as string) ?? null,
    releasedAt: (row.released_at as string) ?? null,
    refundedAt: (row.refunded_at as string) ?? null,
    appealedAt: (row.appealed_at as string) ?? null,
    appealedBy: (row.appealed_by as string) ?? null,
    paidAt: (row.paid_at as string) ?? null,
    txSignature: (row.tx_signature as string) ?? null,
  };
}

function linkToRow(link: PaymentLink): Record<string, unknown> {
  return {
    id: link.id,
    type: link.type,
    creator: link.creator,
    recipient: link.recipient,
    amount: link.amount,
    allow_custom_amount: link.allowCustomAmount,
    token_type: link.tokenType,
    token_mint: link.tokenMint,
    status: link.status,
    memo: link.memo,
    created_at: link.createdAt,
    link_url: link.linkUrl,
    expires_at: link.expiresAt,
    payments: link.payments,
    total_received: link.totalReceived,
    escrow_pda: link.escrowPda,
    nonce: link.nonce,
    timeout_seconds: link.timeoutSeconds,
    funded_at: link.fundedAt,
    released_at: link.releasedAt,
    refunded_at: link.refundedAt,
    appealed_at: link.appealedAt,
    appealed_by: link.appealedBy,
    paid_at: link.paidAt,
    tx_signature: link.txSignature,
  };
}

// ─── Public API (all async) ──────────────────────────────────────────────────

export async function createPaymentLink(
  params: CreateLinkParams & {
    creator: string;
    escrowPda?: string | null;
    nonce?: string | null;
  }
): Promise<PaymentLink> {
  const id = generateLinkId();

  const link: PaymentLink = {
    id,
    type: params.type,
    creator: params.creator,
    recipient: params.recipient,
    amount: params.amount,
    allowCustomAmount: params.allowCustomAmount,
    tokenType: params.tokenType,
    tokenMint:
      params.tokenType === "USDC"
        ? "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU"
        : null,
    status: params.type === "escrow" ? "pending" : "active",
    memo: params.memo,
    createdAt: new Date().toISOString(),
    linkUrl: `${getOrigin()}/pay/${id}`,
    expiresAt: params.expiresAt,
    payments: [],
    totalReceived: 0,
    escrowPda: params.escrowPda ?? null,
    nonce: params.nonce ?? null,
    timeoutSeconds: params.timeoutSeconds ?? null,
    fundedAt: null,
    releasedAt: null,
    refundedAt: null,
    appealedAt: null,
    appealedBy: null,
    paidAt: null,
    txSignature: null,
  };

  // Write to Supabase first, then cache locally
  if (isSupabaseEnabled) {
    const { error } = await supabase!
      .from("payment_links")
      .insert(linkToRow(link));
    if (error) {
      console.error("[linkStore] insert error:", error.message);
      // Fall through — still cache locally so the UI works
    }
  }

  cacheUpsert(link);
  return link;
}

export async function getLinkById(id: string): Promise<PaymentLink | undefined> {
  // 1. Try Supabase
  if (isSupabaseEnabled) {
    const { data, error } = await supabase!
      .from("payment_links")
      .select("*")
      .eq("id", id)
      .maybeSingle();

    if (!error && data) {
      const link = rowToLink(data);
      cacheUpsert(link); // keep cache warm
      return link;
    }
    if (error) {
      console.error("[linkStore] getLinkById error:", error.message);
    }
  }

  // 2. Fallback to localStorage cache
  return cacheLoad().find((l) => l.id === id);
}

export async function getAllLinks(): Promise<PaymentLink[]> {
  if (isSupabaseEnabled) {
    const { data, error } = await supabase!
      .from("payment_links")
      .select("*")
      .order("created_at", { ascending: false });

    if (!error && data) {
      const links = data.map(rowToLink);
      cacheSave(links);
      return links;
    }
    if (error) console.error("[linkStore] getAllLinks error:", error.message);
  }

  return cacheLoad();
}

export async function getLinksByWallet(wallet: string): Promise<PaymentLink[]> {
  if (isSupabaseEnabled) {
    const { data, error } = await supabase!
      .from("payment_links")
      .select("*")
      .or(`creator.eq.${wallet},recipient.eq.${wallet}`)
      .order("created_at", { ascending: false });

    if (!error && data) {
      const links = data.map(rowToLink);
      // Merge into cache (don't overwrite unrelated links)
      const cached = cacheLoad();
      const merged = [
        ...links,
        ...cached.filter((c) => !links.find((l) => l.id === c.id)),
      ];
      cacheSave(merged);
      return links;
    }
    if (error) console.error("[linkStore] getLinksByWallet error:", error.message);
  }

  return cacheLoad().filter(
    (l) => l.creator === wallet || l.recipient === wallet
  );
}

export async function updateLinkStatus(
  id: string,
  status: LinkStatus,
  extra?: Partial<PaymentLink>
): Promise<PaymentLink | undefined> {
  const existing = await getLinkById(id);
  if (!existing) return undefined;

  const updated: PaymentLink = { ...existing, status, ...extra };

  if (isSupabaseEnabled) {
    const { error } = await supabase!
      .from("payment_links")
      .update(linkToRow(updated))
      .eq("id", id);
    if (error) console.error("[linkStore] updateLinkStatus error:", error.message);
  }

  cacheUpsert(updated);
  return updated;
}

export async function appealEscrow(
  linkId: string,
  appealerAddress: string
): Promise<PaymentLink | undefined> {
  const link = await getLinkById(linkId);
  if (!link) return undefined;
  if (link.type !== "escrow" || link.status !== "funded") return undefined;
  if (appealerAddress !== link.creator && appealerAddress !== link.recipient)
    return undefined;

  return updateLinkStatus(linkId, "appealed", {
    appealedAt: new Date().toISOString(),
    appealedBy: appealerAddress,
  });
}

export async function recordPayment(
  linkId: string,
  payment: Omit<PaymentRecord, "id">
): Promise<PaymentLink | undefined> {
  const link = await getLinkById(linkId);
  if (!link) return undefined;

  const record: PaymentRecord = { id: generatePaymentId(), ...payment };
  const payments = [record, ...(link.payments || [])];
  const totalReceived = (link.totalReceived || 0) + payment.amount;

  const extra: Partial<PaymentLink> =
    link.type === "one-time"
      ? {
          payments,
          totalReceived,
          status: "completed",
          paidAt: payment.paidAt,
          txSignature: payment.txSignature,
        }
      : { payments, totalReceived };

  return updateLinkStatus(linkId, link.type === "one-time" ? "completed" : link.status, extra);
}
