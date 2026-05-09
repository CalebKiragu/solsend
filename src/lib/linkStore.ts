import type { PaymentLink, CreateLinkParams, LinkStatus, PaymentRecord } from "./types";

const STORAGE_KEY = "solsend_links";

function getOrigin(): string {
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

function load(): PaymentLink[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch {
    // ignore
  }
  return [];
}

function save(links: PaymentLink[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(links));
}

export function generateLinkId(): string {
  return crypto.randomUUID().replace(/-/g, "").slice(0, 12);
}

export function generatePaymentId(): string {
  return crypto.randomUUID().replace(/-/g, "").slice(0, 8);
}

export function createPaymentLink(
  params: CreateLinkParams & {
    creator: string;
    escrowPda?: string | null;
    nonce?: string | null;
  }
): PaymentLink {
  const id = generateLinkId();

  let initialStatus: LinkStatus;
  if (params.type === "escrow") {
    initialStatus = "pending";
  } else {
    initialStatus = "active";
  }

  const link: PaymentLink = {
    id,
    type: params.type,
    creator: params.creator,
    recipient: params.recipient,
    amount: params.amount,
    allowCustomAmount: params.allowCustomAmount,
    tokenType: params.tokenType,
    tokenMint: params.tokenType === "USDC" ? "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU" : null,
    status: initialStatus,
    memo: params.memo,
    createdAt: new Date().toISOString(),
    linkUrl: `${getOrigin()}/pay/${id}`,
    expiresAt: params.expiresAt,
    // Recurring
    payments: [],
    totalReceived: 0,
    // Escrow fields
    escrowPda: params.escrowPda || null,
    nonce: params.nonce || null,
    timeoutSeconds: params.timeoutSeconds ?? null,
    fundedAt: null,
    releasedAt: null,
    refundedAt: null,
    appealedAt: null,
    appealedBy: null,
    // One-time direct fields
    paidAt: null,
    txSignature: null,
  };

  const links = [link, ...load()];
  save(links);
  return link;
}

export function getLinkById(id: string): PaymentLink | undefined {
  return load().find((l) => l.id === id);
}

export function getAllLinks(): PaymentLink[] {
  return load();
}

export function getLinksByWallet(wallet: string): PaymentLink[] {
  return load().filter(
    (l) => l.creator === wallet || l.recipient === wallet
  );
}

export function updateLinkStatus(
  id: string,
  status: LinkStatus,
  extra?: Partial<PaymentLink>
): PaymentLink | undefined {
  const links = load();
  const idx = links.findIndex((l) => l.id === id);
  if (idx === -1) return undefined;

  links[idx] = {
    ...links[idx],
    status,
    ...extra,
  };

  save(links);
  return links[idx];
}

/** Appeal an escrow -- suspends all actions until manual arbitration */
export function appealEscrow(
  linkId: string,
  appealerAddress: string
): PaymentLink | undefined {
  const links = load();
  const idx = links.findIndex((l) => l.id === linkId);
  if (idx === -1) return undefined;

  const link = links[idx];
  if (link.type !== "escrow" || link.status !== "funded") return undefined;

  // Either party can appeal
  if (appealerAddress !== link.creator && appealerAddress !== link.recipient) return undefined;

  link.status = "appealed";
  link.appealedAt = new Date().toISOString();
  link.appealedBy = appealerAddress;

  save(links);
  return link;
}

/** Record a payment on a link (used for both one-time and recurring) */
export function recordPayment(
  linkId: string,
  payment: Omit<PaymentRecord, "id">
): PaymentLink | undefined {
  const links = load();
  const idx = links.findIndex((l) => l.id === linkId);
  if (idx === -1) return undefined;

  const record: PaymentRecord = {
    id: generatePaymentId(),
    ...payment,
  };

  const link = links[idx];
  link.payments = [record, ...(link.payments || [])];
  link.totalReceived = (link.totalReceived || 0) + payment.amount;

  // For one-time links, mark as completed after first payment
  if (link.type === "one-time") {
    link.status = "completed";
    link.paidAt = payment.paidAt;
    link.txSignature = payment.txSignature;
  }

  save(links);
  return links[idx];
}