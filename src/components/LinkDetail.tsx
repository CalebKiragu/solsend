import React, { useState, useEffect, useCallback } from "react";
import { useParams, Link } from "react-router-dom";
import { useWallet, useConnection } from "@solana/wallet-adapter-react";
import { PublicKey } from "@solana/web3.js";
import {
  Shield,
  Clock,
  Send,
  Repeat,
  ArrowUpRight,
  Loader2,
  AlertCircle,
  CheckCircle,
  XCircle,
  Copy,
  ExternalLink,
  Coins,
  Timer,
  ArrowLeft,
  CalendarClock,
  Infinity,
  Hash,
  AlertTriangle,
  Info,
  Ban,
  Undo2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { getLinkById, updateLinkStatus, recordPayment, appealEscrow, safeClipboardWrite } from "@/lib/linkStore";
import { useEscrowSDK } from "@/hooks/useEscrowSDK";
import {
  buildFundEscrowSolTx,
  buildReleaseSolTx,
  buildFundEscrowSplTx,
  buildReleaseSplTx,
  getTokenMint,
} from "@/lib/escrowProgram";
import {
  shortenAddress,
  formatCountdown,
  getStatusColor,
  getStatusLabel,
  getTypeLabel,
  getTypeColor,
  getExpiryLabel,
  isLinkExpired,
  isEscrowTimedOut,
  getEscrowRole,
  TOKEN_LABELS,
} from "@/lib/types";
import type { PaymentLink, EscrowRole } from "@/lib/types";
import { useToast } from "@/hooks/use-toast";

/* ============================================================
   Escrow Explainer Component
   ============================================================ */
const EscrowExplainer: React.FC<{ role: EscrowRole; status: string }> = ({ role, status }) => {
  if (status === "pending") {
    return (
      <div className="p-4 rounded-lg bg-secondary/80 border border-border space-y-2">
        <div className="flex items-start gap-2">
          <Info className="h-4 w-4 text-primary mt-0.5 flex-shrink-0" />
          <div className="space-y-1.5">
            <p className="text-xs font-semibold text-foreground">How Escrow Works</p>
            <p className="text-[11px] text-muted-foreground leading-relaxed">
              The <span className="text-foreground font-medium">payer (creator)</span> funds the escrow, locking funds on-chain.
              Once funded, only the payer can release the funds to the recipient.
              The recipient can request a refund/reversal, which returns funds to the payer.
              If the payer does not release before the timeout elapses, funds auto-refund.
              Either party may file an appeal to suspend the escrow for arbitration.
            </p>
          </div>
        </div>
      </div>
    );
  }

  if (status === "funded") {
    return (
      <div className="p-4 rounded-lg bg-secondary/80 border border-border space-y-3">
        <div className="flex items-start gap-2">
          <Info className="h-4 w-4 text-primary mt-0.5 flex-shrink-0" />
          <p className="text-xs font-semibold text-foreground">Escrow is funded and active</p>
        </div>
        <div className="space-y-2 pl-6">
          {role === "payer" && (
            <>
              <RuleLine
                icon={<CheckCircle className="h-3 w-3 text-primary" />}
                text="You can release funds to the recipient at any time."
              />
              <RuleLine
                icon={<Clock className="h-3 w-3 text-muted-foreground" />}
                text="You cannot self-refund. If you don't release before the timeout, funds auto-refund to you."
              />
              <RuleLine
                icon={<AlertTriangle className="h-3 w-3 text-orange-400" />}
                text="You can appeal to suspend the escrow for manual arbitration."
              />
            </>
          )}
          {role === "recipient" && (
            <>
              <RuleLine
                icon={<Undo2 className="h-3 w-3 text-destructive" />}
                text="You can request a refund/reversal to return funds to the payer."
              />
              <RuleLine
                icon={<Ban className="h-3 w-3 text-muted-foreground" />}
                text="You cannot release the escrow to yourself."
              />
              <RuleLine
                icon={<AlertTriangle className="h-3 w-3 text-orange-400" />}
                text="You can appeal to suspend the escrow for manual arbitration."
              />
            </>
          )}
          {role === "none" && (
            <RuleLine
              icon={<Info className="h-3 w-3 text-muted-foreground" />}
              text="Only the payer and recipient can interact with this escrow."
            />
          )}
        </div>
      </div>
    );
  }

  if (status === "appealed") {
    return (
      <div className="p-4 rounded-lg bg-orange-500/5 border border-orange-500/20 space-y-2">
        <div className="flex items-start gap-2">
          <AlertTriangle className="h-4 w-4 text-orange-400 mt-0.5 flex-shrink-0" />
          <div className="space-y-1.5">
            <p className="text-xs font-semibold text-orange-300">Escrow Under Appeal</p>
            <p className="text-[11px] text-muted-foreground leading-relaxed">
              This escrow has been suspended. No releases, refunds, or timeout actions can occur
              until the dispute is resolved through manual arbitration. Both parties should contact
              the arbitration channel to resolve this matter.
            </p>
          </div>
        </div>
      </div>
    );
  }

  return null;
};

const RuleLine: React.FC<{ icon: React.ReactNode; text: string }> = ({ icon, text }) => (
  <div className="flex items-start gap-2">
    <span className="mt-0.5 flex-shrink-0">{icon}</span>
    <p className="text-[11px] text-muted-foreground leading-relaxed">{text}</p>
  </div>
);

/* ============================================================
   Main LinkDetail Component
   ============================================================ */
const LinkDetail: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const { publicKey, sendTransaction } = useWallet();
  const { connection } = useConnection();
  const sdk = useEscrowSDK();
  const { toast } = useToast();

  const [link, setLink] = useState<PaymentLink | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [countdown, setCountdown] = useState<number | null>(null);
  const [txSig, setTxSig] = useState<string | null>(null);
  const [customAmount, setCustomAmount] = useState("");

  const walletAddress = publicKey?.toBase58() ?? null;
  const role: EscrowRole = link ? getEscrowRole(link, walletAddress) : "none";

  const loadLink = useCallback(() => {
    if (!id) return;
    const found = getLinkById(id);
    if (found) {
      // Check expiry for non-escrow links
      if (isLinkExpired(found) && found.status === "active") {
        updateLinkStatus(found.id, "expired");
        found.status = "expired";
      }
      // Check escrow timeout auto-refund (only if not appealed)
      if (found.type === "escrow" && found.status === "funded" && isEscrowTimedOut(found)) {
        updateLinkStatus(found.id, "refunded", { refundedAt: new Date().toISOString() });
        found.status = "refunded";
        found.refundedAt = new Date().toISOString();
      }
    }
    setLink(found || null);
    setLoading(false);
  }, [id]);

  useEffect(() => {
    loadLink();
  }, [loadLink]);

  // Countdown timer for escrow timeout
  useEffect(() => {
    if (!link || link.type !== "escrow" || !link.fundedAt || !link.timeoutSeconds) return;
    if (link.status !== "funded") return;

    const fundedTime = new Date(link.fundedAt).getTime();
    const expiresAt = fundedTime + link.timeoutSeconds * 1000;

    const interval = setInterval(() => {
      const remaining = Math.max(0, Math.floor((expiresAt - Date.now()) / 1000));
      setCountdown(remaining);

      if (remaining <= 0) {
        // Timeout elapsed -- auto refund
        updateLinkStatus(link.id, "refunded", { refundedAt: new Date().toISOString() });
        loadLink();
        clearInterval(interval);
      }
    }, 1000);

    return () => clearInterval(interval);
  }, [link, loadLink]);

  // Expiry countdown for non-escrow links
  const [expiryCountdown, setExpiryCountdown] = useState<string | null>(null);
  useEffect(() => {
    if (!link || !link.expiresAt) return;
    const interval = setInterval(() => {
      setExpiryCountdown(getExpiryLabel(link.expiresAt));
    }, 1000);
    setExpiryCountdown(getExpiryLabel(link.expiresAt));
    return () => clearInterval(interval);
  }, [link]);

  // ===== Direct / Recurring Payment =====
  const handleDirectPay = async () => {
    if (!publicKey || !link || !sendTransaction) return;

    const payAmount =
      link.allowCustomAmount && link.type === "recurring"
        ? parseFloat(customAmount)
        : link.amount;

    if (!payAmount || payAmount <= 0) {
      toast({ title: "Enter a valid amount", variant: "destructive" });
      return;
    }

    setActionLoading(true);

    try {
      let tx;
      const recipientPk = new PublicKey(link.recipient);

      if (link.tokenType === "SOL") {
        tx = await buildFundEscrowSolTx(connection, publicKey, recipientPk, payAmount);
      } else {
        const mint = getTokenMint(link.tokenType);
        if (!mint) throw new Error("Unsupported token");
        tx = await buildFundEscrowSplTx(connection, publicKey, recipientPk, payAmount, mint);
      }

      const sig = await sendTransaction(tx, connection);
      await connection.confirmTransaction(sig, "confirmed");

      setTxSig(sig);

      recordPayment(link.id, {
        payer: publicKey.toBase58(),
        amount: payAmount,
        tokenType: link.tokenType,
        txSignature: sig,
        paidAt: new Date().toISOString(),
      });

      loadLink();

      toast({
        title: "Payment sent",
        description: `${payAmount} ${TOKEN_LABELS[link.tokenType]} sent to ${shortenAddress(link.recipient)}`,
      });

      setCustomAmount("");
    } catch (err: any) {
      toast({
        title: "Transaction failed",
        description: err?.message || "Unknown error",
        variant: "destructive",
      });
    } finally {
      setActionLoading(false);
    }
  };

  // ===== Escrow: Fund (payer only) =====
  const handleFundEscrow = async () => {
    if (!publicKey || !link || !sdk || !link.escrowPda) return;
    if (role !== "payer") return;
    setActionLoading(true);

    try {
      const escrowAddress = new PublicKey(link.escrowPda);
      let result;

      if (link.tokenType === "SOL") {
        result = await sdk.fundEscrowSol(escrowAddress);
      } else {
        result = await sdk.fundEscrowSpl(escrowAddress);
      }

      if (!result.success) throw new Error(result.error);

      setTxSig(result.data!.signature);
      updateLinkStatus(link.id, "funded", { fundedAt: new Date().toISOString() });
      loadLink();

      toast({
        title: "Escrow funded",
        description: `Tx: ${result.data!.signature.slice(0, 8)}...`,
      });
    } catch (err: any) {
      toast({
        title: "Transaction failed",
        description: err?.message || "Unknown error",
        variant: "destructive",
      });
    } finally {
      setActionLoading(false);
    }
  };

  // ===== Escrow: Release (payer only) =====
  const handleReleaseEscrow = async () => {
    if (!publicKey || !link || !sdk || !link.escrowPda) return;
    if (role !== "payer") return;
    setActionLoading(true);

    try {
      const escrowAddress = new PublicKey(link.escrowPda);
      let result;

      if (link.tokenType === "SOL") {
        result = await sdk.releaseEscrowSol(escrowAddress);
      } else {
        result = await sdk.releaseEscrowSpl(escrowAddress);
      }

      if (!result.success) throw new Error(result.error);

      setTxSig(result.data!.signature);
      updateLinkStatus(link.id, "released", { releasedAt: new Date().toISOString() });
      loadLink();

      toast({
        title: "Funds released",
        description: `Sent to ${shortenAddress(link.recipient)}`,
      });
    } catch (err: any) {
      toast({
        title: "Transaction failed",
        description: err?.message || "Unknown error",
        variant: "destructive",
      });
    } finally {
      setActionLoading(false);
    }
  };

  // ===== Escrow: Refund (recipient only) =====
  const handleRefundEscrow = async () => {
    if (!publicKey || !link || !sdk || !link.escrowPda) return;
    if (role !== "recipient") return;
    setActionLoading(true);

    try {
      const escrowAddress = new PublicKey(link.escrowPda);
      let result;

      if (link.tokenType === "SOL") {
        result = await sdk.refundEscrowSol(escrowAddress);
      } else {
        result = await sdk.refundEscrowSpl(escrowAddress);
      }

      if (!result.success) throw new Error(result.error);

      setTxSig(result.data!.signature);
      updateLinkStatus(link.id, "refunded", { refundedAt: new Date().toISOString() });
      loadLink();

      toast({ title: "Escrow refunded to payer" });
    } catch (err: any) {
      toast({
        title: "Refund failed",
        description: err?.message || "Unknown error",
        variant: "destructive",
      });
    } finally {
      setActionLoading(false);
    }
  };

  // ===== Escrow: Appeal (either party) =====
  const handleAppealEscrow = async () => {
    if (!walletAddress || !link) return;
    if (role !== "payer" && role !== "recipient") return;
    setActionLoading(true);

    try {
      const updated = appealEscrow(link.id, walletAddress);
      if (!updated) throw new Error("Unable to appeal this escrow");

      loadLink();
      toast({
        title: "Appeal filed",
        description: "Escrow is now suspended pending arbitration.",
      });
    } catch (err: any) {
      toast({
        title: "Appeal failed",
        description: err?.message || "Unknown error",
        variant: "destructive",
      });
    } finally {
      setActionLoading(false);
    }
  };

  // ===== Renders =====

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!link) {
    return (
      <div className="glass-card p-8 max-w-lg mx-auto text-center animate-fade-in">
        <XCircle className="h-12 w-12 text-destructive mx-auto mb-4" />
        <h2 className="text-lg font-bold text-foreground mb-2">Link Not Found</h2>
        <p className="text-sm text-muted-foreground mb-6">
          This payment link doesn't exist or has been removed.
        </p>
        <Link to="/">
          <Button className="bg-primary text-primary-foreground hover:bg-emerald-glow">
            Create New Link
          </Button>
        </Link>
      </div>
    );
  }

  const isEscrow = link.type === "escrow";
  const isRecurring = link.type === "recurring";
  const isActive = link.status === "active";
  const isFinal = ["completed", "released", "refunded", "expired"].includes(link.status);
  const isAppealed = link.status === "appealed";

  return (
    <div className="max-w-lg mx-auto animate-fade-in space-y-4">
      <Link
        to="/dashboard"
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        Back to Dashboard
      </Link>

      {/* Header Card */}
      <div className="glass-card p-6">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 border border-primary/20">
              {isEscrow ? (
                <Shield className="h-5 w-5 text-primary" />
              ) : isRecurring ? (
                <Repeat className="h-5 w-5 text-primary" />
              ) : (
                <Send className="h-5 w-5 text-primary" />
              )}
            </div>
            <div>
              <h2 className="text-lg font-bold text-foreground">
                {isEscrow
                  ? "Escrow Payment"
                  : isRecurring
                  ? "Recurring Payment Link"
                  : "Payment Request"}
              </h2>
              <div className="flex items-center gap-2">
                <p className="text-xs text-muted-foreground font-mono">ID: {link.id}</p>
                <span
                  className={`text-[10px] px-1.5 py-0.5 rounded font-semibold ${getTypeColor(
                    link.type
                  )}`}
                >
                  {getTypeLabel(link.type).toUpperCase()}
                </span>
              </div>
            </div>
          </div>
          <span
            className={`px-3 py-1.5 rounded-full text-xs font-semibold ${getStatusColor(
              link.status
            )}`}
          >
            {getStatusLabel(link.status)}
          </span>
        </div>

        {/* Amount */}
        <div className="text-center py-6 border-y border-border">
          {link.allowCustomAmount ? (
            <div>
              <p className="text-sm text-muted-foreground mb-1">Custom Amount</p>
              <p className="text-2xl font-bold text-foreground">
                Any <span className="text-primary">{TOKEN_LABELS[link.tokenType]}</span>
              </p>
            </div>
          ) : (
            <p className="text-3xl font-bold text-foreground">
              {link.amount}{" "}
              <span className="text-primary">{TOKEN_LABELS[link.tokenType]}</span>
            </p>
          )}
          {link.memo && (
            <p className="text-sm text-muted-foreground mt-2">"{link.memo}"</p>
          )}
        </div>

        {/* Your Role Badge (escrow only) */}
        {isEscrow && walletAddress && role !== "none" && (
          <div className="mt-4 flex items-center gap-2">
            <span className="text-[11px] text-muted-foreground uppercase tracking-wider font-medium">
              Your role:
            </span>
            <span
              className={`text-[11px] px-2 py-0.5 rounded-full font-semibold ${
                role === "payer"
                  ? "bg-primary/10 text-primary border border-primary/20"
                  : "bg-blue-500/10 text-blue-400 border border-blue-500/20"
              }`}
            >
              {role === "payer" ? "Payer / Funder" : "Recipient"}
            </span>
          </div>
        )}

        {/* Details Grid */}
        <div className="grid grid-cols-2 gap-4 mt-5">
          <div className="space-y-1">
            <p className="text-[11px] text-muted-foreground uppercase tracking-wider font-medium">
              {isEscrow ? "Payer (Creator)" : "Recipient"}
            </p>
            <div className="flex items-center gap-1.5">
              <p className="font-mono text-xs text-foreground">
                {shortenAddress(isEscrow ? link.creator : link.recipient)}
              </p>
              <button
                onClick={() => {
                  safeClipboardWrite(isEscrow ? link.creator : link.recipient);
                  toast({ title: "Copied" });
                }}
                className="text-muted-foreground hover:text-foreground"
              >
                <Copy className="h-3 w-3" />
              </button>
            </div>
          </div>
          <div className="space-y-1">
            <p className="text-[11px] text-muted-foreground uppercase tracking-wider font-medium">
              {isEscrow ? "Recipient" : "Created by"}
            </p>
            <div className="flex items-center gap-1.5">
              <p className="font-mono text-xs text-foreground">
                {shortenAddress(isEscrow ? link.recipient : link.creator)}
              </p>
              <button
                onClick={() => {
                  safeClipboardWrite(isEscrow ? link.recipient : link.creator);
                  toast({ title: "Copied" });
                }}
                className="text-muted-foreground hover:text-foreground"
              >
                <Copy className="h-3 w-3" />
              </button>
            </div>
          </div>
          <div className="space-y-1">
            <p className="text-[11px] text-muted-foreground uppercase tracking-wider font-medium">
              Expiry
            </p>
            <div className="flex items-center gap-1.5">
              {link.expiresAt ? (
                <>
                  <CalendarClock className="h-3 w-3 text-muted-foreground" />
                  <p className="text-xs text-foreground">{expiryCountdown || getExpiryLabel(link.expiresAt)}</p>
                </>
              ) : (
                <>
                  <Infinity className="h-3 w-3 text-primary" />
                  <p className="text-xs text-primary font-medium">Never</p>
                </>
              )}
            </div>
          </div>
          {isRecurring && (
            <div className="space-y-1">
              <p className="text-[11px] text-muted-foreground uppercase tracking-wider font-medium">
                Payments received
              </p>
              <div className="flex items-center gap-1.5">
                <Hash className="h-3 w-3 text-muted-foreground" />
                <p className="text-xs text-foreground font-semibold">
                  {link.payments?.length || 0} ({link.totalReceived || 0}{" "}
                  {TOKEN_LABELS[link.tokenType]})
                </p>
              </div>
            </div>
          )}
          {isEscrow && link.timeoutSeconds && (
            <div className="space-y-1">
              <p className="text-[11px] text-muted-foreground uppercase tracking-wider font-medium">
                Timeout
              </p>
              <p className="text-xs text-foreground">
                {link.timeoutSeconds >= 86400
                  ? `${link.timeoutSeconds / 86400} days`
                  : link.timeoutSeconds >= 3600
                  ? `${link.timeoutSeconds / 3600} hours`
                  : `${link.timeoutSeconds / 60} minutes`}
              </p>
            </div>
          )}
          {isEscrow && link.appealedAt && (
            <div className="space-y-1">
              <p className="text-[11px] text-muted-foreground uppercase tracking-wider font-medium">
                Appealed by
              </p>
              <p className="font-mono text-xs text-orange-400">
                {shortenAddress(link.appealedBy || "")}
              </p>
            </div>
          )}
        </div>

        {/* Escrow Countdown */}
        {isEscrow &&
          link.status === "funded" &&
          countdown !== null &&
          link.timeoutSeconds && (
            <div className="mt-5 p-4 rounded-lg bg-secondary border border-border">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Timer className="h-4 w-4 text-primary" />
                  <span className="text-xs font-medium text-muted-foreground">
                    Auto-refund countdown
                  </span>
                </div>
                <span className="font-mono text-sm font-bold text-foreground">
                  {formatCountdown(countdown)}
                </span>
              </div>
              <p className="text-[10px] text-muted-foreground mt-2">
                If the payer does not release before the timeout, funds automatically return to the payer.
              </p>
            </div>
          )}

        {/* Transaction info */}
        {(txSig || link.txSignature) && (
          <div className="mt-4 p-3 rounded-lg bg-secondary/50 border border-border">
            <div className="flex items-center justify-between">
              <span className="text-xs text-muted-foreground">Last Transaction</span>
              <a
                href={`https://explorer.solana.com/tx/${txSig || link.txSignature}?cluster=devnet`}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1 text-xs text-primary hover:text-emerald-glow"
              >
                {shortenAddress(txSig || link.txSignature || "", 6)}
                <ExternalLink className="h-3 w-3" />
              </a>
            </div>
          </div>
        )}
      </div>

      {/* Escrow Explainer Card */}
      {isEscrow && !isFinal && <EscrowExplainer role={role} status={link.status} />}

      {/* Actions Card */}
      <div className="glass-card p-6">
        <h3 className="text-sm font-semibold text-foreground mb-4">Actions</h3>

        {!publicKey && (
          <div className="flex items-center gap-2 p-3 rounded-lg bg-secondary border border-border">
            <AlertCircle className="h-4 w-4 text-muted-foreground" />
            <p className="text-xs text-muted-foreground">
              Connect your wallet to interact with this payment link.
            </p>
          </div>
        )}

        {/* ---- ONE-TIME / RECURRING PAY ---- */}
        {publicKey && !isEscrow && isActive && (
          <div className="space-y-3">
            <p className="text-xs text-muted-foreground">
              {isRecurring
                ? `This is a recurring payment link. Pay ${
                    link.allowCustomAmount
                      ? "any amount"
                      : `${link.amount} ${TOKEN_LABELS[link.tokenType]}`
                  } directly to the recipient.`
                : `Pay ${link.amount} ${TOKEN_LABELS[link.tokenType]} directly to the recipient.`}
            </p>
            {link.allowCustomAmount && isRecurring && (
              <div className="space-y-1.5">
                <p className="text-[11px] text-muted-foreground font-medium">Enter amount</p>
                <Input
                  type="number"
                  step="0.001"
                  min="0"
                  placeholder={`Amount in ${TOKEN_LABELS[link.tokenType]}`}
                  value={customAmount}
                  onChange={(e) => setCustomAmount(e.target.value)}
                  className="bg-secondary border-border text-foreground placeholder:text-muted-foreground text-sm"
                />
              </div>
            )}
            <Button
              onClick={handleDirectPay}
              disabled={actionLoading}
              className="w-full bg-primary text-primary-foreground hover:bg-emerald-glow font-semibold h-11"
            >
              {actionLoading ? (
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
              ) : (
                <Send className="h-4 w-4 mr-2" />
              )}
              Pay{" "}
              {link.allowCustomAmount
                ? customAmount
                  ? `${customAmount} ${TOKEN_LABELS[link.tokenType]}`
                  : TOKEN_LABELS[link.tokenType]
                : `${link.amount} ${TOKEN_LABELS[link.tokenType]}`}
            </Button>
          </div>
        )}

        {/* ---- ESCROW: PENDING (not yet funded) ---- */}
        {publicKey && isEscrow && link.status === "pending" && (
          <div className="space-y-3">
            {role === "payer" ? (
              <>
                <p className="text-xs text-muted-foreground">
                  You created this escrow. Fund it to lock the funds on-chain.
                </p>
                <Button
                  onClick={handleFundEscrow}
                  disabled={actionLoading}
                  className="w-full bg-primary text-primary-foreground hover:bg-emerald-glow font-semibold h-11"
                >
                  {actionLoading ? (
                    <Loader2 className="h-4 w-4 animate-spin mr-2" />
                  ) : (
                    <ArrowUpRight className="h-4 w-4 mr-2" />
                  )}
                  Fund Escrow ({link.amount} {TOKEN_LABELS[link.tokenType]})
                </Button>
              </>
            ) : (
              <div className="p-3 rounded-lg bg-secondary border border-border">
                <p className="text-xs text-muted-foreground">
                  Waiting for the payer ({shortenAddress(link.creator)}) to fund this escrow.
                  Only the payer can deposit funds.
                </p>
              </div>
            )}
          </div>
        )}

        {/* ---- ESCROW: FUNDED -- role-based actions ---- */}
        {publicKey && isEscrow && link.status === "funded" && (
          <div className="space-y-3">
            {/* PAYER: can release + appeal */}
            {role === "payer" && (
              <>
                <div className="flex gap-3">
                  <Button
                    onClick={handleReleaseEscrow}
                    disabled={actionLoading}
                    className="flex-1 bg-primary text-primary-foreground hover:bg-emerald-glow font-semibold h-11"
                  >
                    {actionLoading ? (
                      <Loader2 className="h-4 w-4 animate-spin mr-2" />
                    ) : (
                      <CheckCircle className="h-4 w-4 mr-2" />
                    )}
                    Release to Recipient
                  </Button>
                </div>
                <Button
                  onClick={handleAppealEscrow}
                  disabled={actionLoading}
                  variant="outline"
                  className="w-full border-orange-500/30 text-orange-400 hover:bg-orange-500/10 font-semibold h-10 text-xs"
                >
                  <AlertTriangle className="h-3.5 w-3.5 mr-2" />
                  File Appeal (Suspend Escrow)
                </Button>
                <p className="text-[10px] text-muted-foreground text-center">
                  You cannot self-refund. If you don't release before the timeout, funds will auto-return to you.
                </p>
              </>
            )}

            {/* RECIPIENT: can refund/reverse + appeal */}
            {role === "recipient" && (
              <>
                <Button
                  onClick={handleRefundEscrow}
                  disabled={actionLoading}
                  variant="outline"
                  className="w-full border-destructive/30 text-destructive hover:bg-destructive/10 font-semibold h-11"
                >
                  {actionLoading ? (
                    <Loader2 className="h-4 w-4 animate-spin mr-2" />
                  ) : (
                    <Undo2 className="h-4 w-4 mr-2" />
                  )}
                  Request Refund / Reverse
                </Button>
                <p className="text-[10px] text-muted-foreground text-center">
                  This returns funds to the payer. You cannot release funds to yourself.
                </p>
                <Button
                  onClick={handleAppealEscrow}
                  disabled={actionLoading}
                  variant="outline"
                  className="w-full border-orange-500/30 text-orange-400 hover:bg-orange-500/10 font-semibold h-10 text-xs"
                >
                  <AlertTriangle className="h-3.5 w-3.5 mr-2" />
                  File Appeal (Suspend Escrow)
                </Button>
              </>
            )}

            {/* NEITHER PARTY */}
            {role === "none" && (
              <div className="p-3 rounded-lg bg-secondary border border-border">
                <p className="text-xs text-muted-foreground">
                  Only the payer or recipient can interact with this escrow.
                </p>
              </div>
            )}
          </div>
        )}

        {/* ---- ESCROW: APPEALED ---- */}
        {publicKey && isEscrow && isAppealed && (
          <div className="space-y-3">
            <div className="flex items-center gap-2 p-3 rounded-lg bg-orange-500/5 border border-orange-500/20">
              <AlertTriangle className="h-4 w-4 text-orange-400 flex-shrink-0" />
              <p className="text-xs text-orange-300">
                All actions are suspended. Contact the arbitration channel to resolve this dispute.
              </p>
            </div>
          </div>
        )}

        {/* ---- FINAL STATES ---- */}
        {isFinal && !isRecurring && (
          <div className="text-center py-4">
            <div className="mb-3">
              {link.status === "completed" || link.status === "released" ? (
                <CheckCircle className="h-8 w-8 text-primary mx-auto" />
              ) : (
                <XCircle className="h-8 w-8 text-destructive mx-auto" />
              )}
            </div>
            <p className="text-sm font-semibold text-foreground mb-1">
              {link.status === "completed"
                ? "Payment Complete"
                : link.status === "released"
                ? "Funds Released"
                : link.status === "expired"
                ? "Timeout Elapsed — Auto-Refunded"
                : "Escrow Refunded"}
            </p>
            <p className="text-xs text-muted-foreground">
              {link.status === "completed" || link.status === "released"
                ? `${link.amount} ${TOKEN_LABELS[link.tokenType]} sent to ${shortenAddress(link.recipient)}`
                : link.status === "refunded"
                ? `${link.amount} ${TOKEN_LABELS[link.tokenType]} returned to payer ${shortenAddress(link.creator)}`
                : "This link is no longer accepting payments."}
            </p>
          </div>
        )}

        {isRecurring && link.status === "expired" && (
          <div className="text-center py-4">
            <XCircle className="h-8 w-8 text-destructive mx-auto mb-3" />
            <p className="text-sm font-semibold text-foreground mb-1">Link Expired</p>
            <p className="text-xs text-muted-foreground">
              This recurring link has expired. Total received:{" "}
              {link.totalReceived || 0} {TOKEN_LABELS[link.tokenType]} from{" "}
              {link.payments?.length || 0} payments.
            </p>
          </div>
        )}

        {/* Share */}
        {!isFinal && !isAppealed && (
          <div className="mt-4 pt-4 border-t border-border">
            <div className="flex items-center justify-between">
              <span className="text-xs text-muted-foreground">Share Link</span>
              <button
                onClick={() => {
                  safeClipboardWrite(link.linkUrl);
                  toast({ title: "Link copied" });
                }}
                className="flex items-center gap-1.5 text-xs text-primary hover:text-emerald-glow transition-colors"
              >
                <Copy className="h-3 w-3" />
                Copy
              </button>
            </div>
            <p className="font-mono text-[11px] text-muted-foreground mt-1 break-all">
              {link.linkUrl}
            </p>
          </div>
        )}
      </div>

      {/* Payment History (Recurring) */}
      {isRecurring && link.payments && link.payments.length > 0 && (
        <div className="glass-card p-6">
          <h3 className="text-sm font-semibold text-foreground mb-4">
            Payment History ({link.payments.length})
          </h3>
          <div className="space-y-2">
            {link.payments.map((p) => (
              <div
                key={p.id}
                className="flex items-center justify-between p-3 rounded-lg bg-secondary/50 border border-border"
              >
                <div className="flex items-center gap-3">
                  <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10 border border-primary/20">
                    <Send className="h-3.5 w-3.5 text-primary" />
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-foreground">
                      {p.amount} {TOKEN_LABELS[p.tokenType]}
                    </p>
                    <p className="text-[10px] text-muted-foreground font-mono">
                      From {shortenAddress(p.payer)}
                    </p>
                  </div>
                </div>
                <div className="text-right">
                  <a
                    href={`https://explorer.solana.com/tx/${p.txSignature}?cluster=devnet`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-1 text-xs text-primary hover:text-emerald-glow"
                  >
                    {shortenAddress(p.txSignature, 4)}
                    <ExternalLink className="h-3 w-3" />
                  </a>
                  <p className="text-[10px] text-muted-foreground mt-0.5">
                    {new Date(p.paidAt).toLocaleString()}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

export default LinkDetail;