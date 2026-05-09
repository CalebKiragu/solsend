import React, { useState, useCallback } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { PublicKey } from "@solana/web3.js";
import { useNavigate } from "react-router-dom";
import {
  Link2,
  Clock,
  Coins,
  User,
  FileText,
  AlertCircle,
  Loader2,
  CheckCircle,
  Shield,
  Send,
  Repeat,
  Infinity,
  CalendarClock,
  Info,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { TokenType, LinkType } from "@/lib/types";
import { TOKEN_LABELS, USDC_MINT_DEVNET } from "@/lib/types";
import { createPaymentLink, safeClipboardWrite } from "@/lib/linkStore";
import { useEscrowSDK } from "@/hooks/useEscrowSDK";
import { TOKEN_TYPE } from "@/lib/solpayEscrow";
import { useToast } from "@/hooks/use-toast";

const TIMEOUT_OPTIONS = [
  { label: "No timeout", value: null },
  { label: "15 min", value: 900 },
  { label: "1 hour", value: 3600 },
  { label: "24 hours", value: 86400 },
  { label: "7 days", value: 604800 },
];

const EXPIRY_OPTIONS = [
  { label: "No expiry", value: null },
  { label: "1 hour", ms: 3600_000 },
  { label: "24 hours", ms: 86400_000 },
  { label: "7 days", ms: 604800_000 },
  { label: "30 days", ms: 2592000_000 },
  { label: "1 year", ms: 31536000_000 },
];

const CreateLink: React.FC = () => {
  const { publicKey } = useWallet();
  const sdk = useEscrowSDK();
  const navigate = useNavigate();
  const { toast } = useToast();

  const [linkType, setLinkType] = useState<LinkType>("one-time");
  const [recipient, setRecipient] = useState("");
  const [amount, setAmount] = useState("");
  const [allowCustomAmount, setAllowCustomAmount] = useState(false);
  const [tokenType, setTokenType] = useState<TokenType>("SOL");
  const [timeoutSeconds, setTimeoutSeconds] = useState<number | null>(3600);
  const [expiryMs, setExpiryMs] = useState<number | null>(null);
  const [memo, setMemo] = useState("");
  const [isCreating, setIsCreating] = useState(false);
  const [createdLink, setCreatedLink] = useState<string | null>(null);
  const [createdId, setCreatedId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const validateForm = useCallback((): boolean => {
    setError(null);
    if (!publicKey) {
      setError("Connect your wallet first");
      return false;
    }
    if (!recipient.trim()) {
      setError("Recipient address is required");
      return false;
    }
    try {
      new PublicKey(recipient.trim());
    } catch {
      setError("Invalid Solana address for recipient");
      return false;
    }
    // For recurring with custom amounts, amount can be 0
    if (linkType === "recurring" && allowCustomAmount) {
      // no amount validation needed
    } else if (!amount || parseFloat(amount) <= 0) {
      setError("Amount must be greater than 0");
      return false;
    }
    if (recipient.trim() === publicKey.toBase58()) {
      setError("Recipient cannot be the same as your wallet");
      return false;
    }
    return true;
  }, [publicKey, recipient, amount, linkType, allowCustomAmount]);

  const handleCreate = async () => {
    if (!validateForm() || !publicKey) return;

    setIsCreating(true);
    setError(null);

    try {
      const expiresAt = expiryMs ? new Date(Date.now() + expiryMs).toISOString() : null;
      const parsedAmount = allowCustomAmount ? 0 : parseFloat(amount);

      if (linkType === "escrow") {
        if (!sdk) {
          setError("Wallet not fully connected for escrow. Please reconnect.");
          setIsCreating(false);
          return;
        }

        const recipientPk = new PublicKey(recipient.trim());

        // Derive a nonce that guarantees a free PDA slot for this creator+recipient pair
        const nonce = await sdk.generateNonceForPair(publicKey, recipientPk);

        const result = await sdk.createEscrow({
          recipient: recipientPk,
          amount: parsedAmount,
          tokenType: tokenType === "SOL" ? TOKEN_TYPE.SOL : TOKEN_TYPE.SPL,
          tokenMint: tokenType === "USDC" ? USDC_MINT_DEVNET : null,
          timeoutSeconds,
          memo: memo.trim(),
          nonce,
        });

        if (!result || !result.success) {
          setError(result?.error || "Failed to create escrow on-chain");
          setIsCreating(false);
          return;
        }

        const link = await createPaymentLink({
          type: "escrow",
          recipient: recipient.trim(),
          amount: parsedAmount,
          allowCustomAmount: false,
          tokenType,
          timeoutSeconds,
          memo: memo.trim(),
          expiresAt,
          creator: publicKey.toBase58(),
          escrowPda: result.data!.escrowAddress,
          nonce,
        });

        setCreatedLink(link.linkUrl);
        setCreatedId(link.id);
        toast({
          title: "Escrow created on-chain",
          description: `Tx: ${result.data!.signature.slice(0, 8)}...`,
        });
      } else {
        // One-time or Recurring -- just metadata, no on-chain tx
        const link = await createPaymentLink({
          type: linkType,
          recipient: recipient.trim(),
          amount: parsedAmount,
          allowCustomAmount: linkType === "recurring" ? allowCustomAmount : false,
          tokenType,
          memo: memo.trim(),
          expiresAt,
          creator: publicKey.toBase58(),
        });

        setCreatedLink(link.linkUrl);
        setCreatedId(link.id);
        toast({
          title: linkType === "recurring" ? "Recurring link created" : "Payment link created",
        });
      }
    } catch (err: any) {
      setError(err?.message || "Failed to create payment link");
    } finally {
      setIsCreating(false);
    }
  };

  const resetForm = () => {
    setCreatedLink(null);
    setCreatedId(null);
    setRecipient("");
    setAmount("");
    setMemo("");
    setError(null);
    setAllowCustomAmount(false);
  };

  // Success view
  if (createdLink && createdId) {
    return (
      <div className="animate-fade-in">
        <div className="glass-card p-8 max-w-lg mx-auto text-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10 border border-primary/20 mx-auto mb-5">
            <CheckCircle className="h-7 w-7 text-primary" />
          </div>
          <h2 className="text-xl font-bold text-foreground mb-2">
            {linkType === "escrow"
              ? "Escrow Link Created"
              : linkType === "recurring"
              ? "Recurring Link Created"
              : "Payment Link Created"}
          </h2>
          <p className="text-sm text-muted-foreground mb-6">
            {linkType === "recurring"
              ? "Share this link on your website or with customers. It accepts payments repeatedly until expired."
              : linkType === "escrow"
              ? "Share this link with the recipient. You (the payer) will fund and control the release."
              : "Share this link with anyone. They can pay the requested amount directly."}
          </p>
          <div className="bg-secondary rounded-lg p-4 mb-6 border border-border">
            <p className="font-mono text-sm text-primary break-all">{createdLink}</p>
          </div>
          <div className="flex gap-3 justify-center flex-wrap">
            <Button
              onClick={() => {
                safeClipboardWrite(createdLink);
                toast({ title: "Copied to clipboard" });
              }}
              className="bg-primary text-primary-foreground hover:bg-emerald-glow font-semibold"
            >
              Copy Link
            </Button>
            <Button
              variant="outline"
              onClick={() => navigate(`/pay/${createdId}`)}
              className="border-border text-foreground hover:bg-secondary"
            >
              View Details
            </Button>
            <Button
              variant="outline"
              onClick={resetForm}
              className="border-border text-foreground hover:bg-secondary"
            >
              Create Another
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="animate-fade-in">
      <div className="glass-card p-8 max-w-lg mx-auto">
        <div className="flex items-center gap-3 mb-6">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 border border-primary/20">
            <Link2 className="h-5 w-5 text-primary" />
          </div>
          <div>
            <h2 className="text-lg font-bold text-foreground">Create Payment Link</h2>
            <p className="text-xs text-muted-foreground">
              One-time, recurring, or escrow-protected
            </p>
          </div>
        </div>

        <div className="space-y-5">
          {/* Link Type Toggle */}
          <div className="space-y-2">
            <Label className="text-sm font-medium text-foreground">Link Type</Label>
            <div className="grid grid-cols-3 gap-2">
              {([
                {
                  type: "one-time" as LinkType,
                  icon: Send,
                  label: "One-time",
                  desc: "Single payment",
                },
                {
                  type: "recurring" as LinkType,
                  icon: Repeat,
                  label: "Recurring",
                  desc: "Accept many payments",
                },
                {
                  type: "escrow" as LinkType,
                  icon: Shield,
                  label: "Escrow",
                  desc: "On-chain escrow",
                },
              ] as const).map(({ type, icon: Icon, label, desc }) => (
                <button
                  key={type}
                  onClick={() => {
                    setLinkType(type);
                    if (type !== "recurring") setAllowCustomAmount(false);
                  }}
                  className={`flex flex-col items-center gap-1.5 p-3 rounded-lg border transition-all text-center ${
                    linkType === type
                      ? "bg-primary/10 border-primary/30 ring-1 ring-primary/20"
                      : "bg-secondary border-border hover:border-muted-foreground/30"
                  }`}
                >
                  <Icon
                    className={`h-5 w-5 ${
                      linkType === type ? "text-primary" : "text-muted-foreground"
                    }`}
                  />
                  <p
                    className={`text-xs font-semibold ${
                      linkType === type ? "text-primary" : "text-foreground"
                    }`}
                  >
                    {label}
                  </p>
                  <p className="text-[10px] text-muted-foreground leading-tight">{desc}</p>
                </button>
              ))}
            </div>
          </div>

          {/* Recipient */}
          <div className="space-y-2">
            <Label className="text-sm font-medium text-foreground flex items-center gap-2">
              <User className="h-3.5 w-3.5 text-muted-foreground" />
              Recipient Address
            </Label>
            <Input
              placeholder="Solana wallet address..."
              value={recipient}
              onChange={(e) => setRecipient(e.target.value)}
              className="bg-secondary border-border text-foreground placeholder:text-muted-foreground font-mono text-sm"
            />
            <p className="text-[11px] text-muted-foreground">
              The wallet address that will receive payments.
            </p>
          </div>

          {/* Amount + Token */}
          <div className="grid grid-cols-3 gap-3">
            <div className="col-span-2 space-y-2">
              <Label className="text-sm font-medium text-foreground flex items-center gap-2">
                <Coins className="h-3.5 w-3.5 text-muted-foreground" />
                {linkType === "recurring" && allowCustomAmount
                  ? "Suggested Amount (optional)"
                  : "Amount"}
              </Label>
              <Input
                type="number"
                step="0.001"
                min="0"
                placeholder={allowCustomAmount ? "0.00 (payer decides)" : "0.00"}
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                disabled={allowCustomAmount}
                className="bg-secondary border-border text-foreground placeholder:text-muted-foreground text-sm disabled:opacity-50"
              />
            </div>
            <div className="space-y-2">
              <Label className="text-sm font-medium text-foreground">Token</Label>
              <div className="flex gap-1.5">
                {(["SOL", "USDC"] as TokenType[]).map((t) => (
                  <button
                    key={t}
                    onClick={() => setTokenType(t)}
                    className={`flex-1 py-2.5 rounded-lg text-xs font-semibold transition-all border ${
                      tokenType === t
                        ? "bg-primary/10 text-primary border-primary/30"
                        : "bg-secondary text-muted-foreground border-border hover:text-foreground"
                    }`}
                  >
                    {TOKEN_LABELS[t]}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Custom Amount Toggle (Recurring only) */}
          {linkType === "recurring" && (
            <div className="animate-fade-in">
              <button
                onClick={() => {
                  setAllowCustomAmount(!allowCustomAmount);
                  if (!allowCustomAmount) setAmount("");
                }}
                className={`w-full flex items-center gap-3 p-3 rounded-lg border transition-all ${
                  allowCustomAmount
                    ? "bg-primary/10 border-primary/30"
                    : "bg-secondary border-border hover:border-muted-foreground/30"
                }`}
              >
                <div
                  className={`h-5 w-5 rounded-md border-2 flex items-center justify-center transition-all ${
                    allowCustomAmount
                      ? "bg-primary border-primary"
                      : "border-muted-foreground/40"
                  }`}
                >
                  {allowCustomAmount && (
                    <CheckCircle className="h-3 w-3 text-primary-foreground" />
                  )}
                </div>
                <div className="text-left">
                  <p className="text-sm font-medium text-foreground">Allow custom amounts</p>
                  <p className="text-[10px] text-muted-foreground">
                    Let each payer enter their own amount
                  </p>
                </div>
              </button>
            </div>
          )}

          {/* Expiry (One-time and Recurring) */}
          {linkType !== "escrow" && (
            <div className="space-y-2 animate-fade-in">
              <Label className="text-sm font-medium text-foreground flex items-center gap-2">
                <CalendarClock className="h-3.5 w-3.5 text-muted-foreground" />
                Link Expiry
              </Label>
              <div className="flex flex-wrap gap-1.5">
                {EXPIRY_OPTIONS.map((opt) => (
                  <button
                    key={opt.label}
                    onClick={() => setExpiryMs("ms" in opt ? opt.ms : null)}
                    className={`px-3 py-2 rounded-lg text-xs font-medium transition-all border ${
                      expiryMs === ("ms" in opt ? opt.ms : null)
                        ? "bg-primary/10 text-primary border-primary/30"
                        : "bg-secondary text-muted-foreground border-border hover:text-foreground"
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
              <p className="text-[11px] text-muted-foreground">
                {expiryMs === null
                  ? "This link will never expire and can accept payments indefinitely."
                  : "After expiry, the link will no longer accept payments."}
              </p>
            </div>
          )}

          {/* Timeout (Escrow only) */}
          {linkType === "escrow" && (
            <div className="space-y-2 animate-fade-in">
              <Label className="text-sm font-medium text-foreground flex items-center gap-2">
                <Clock className="h-3.5 w-3.5 text-muted-foreground" />
                Auto-refund Timeout
              </Label>
              <div className="flex flex-wrap gap-1.5">
                {TIMEOUT_OPTIONS.map((opt) => (
                  <button
                    key={opt.label}
                    onClick={() => setTimeoutSeconds(opt.value)}
                    className={`px-3 py-2 rounded-lg text-xs font-medium transition-all border ${
                      timeoutSeconds === opt.value
                        ? "bg-primary/10 text-primary border-primary/30"
                        : "bg-secondary text-muted-foreground border-border hover:text-foreground"
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
              <p className="text-[11px] text-muted-foreground">
                If you don't release funds before the timeout elapses, they auto-refund back to you.
              </p>
            </div>
          )}

          {/* Escrow rules explainer */}
          {linkType === "escrow" && (
            <div className="animate-fade-in p-4 rounded-lg bg-secondary/80 border border-border space-y-2">
              <div className="flex items-start gap-2">
                <Info className="h-4 w-4 text-primary mt-0.5 flex-shrink-0" />
                <p className="text-xs font-semibold text-foreground">How Escrow Works</p>
              </div>
              <ul className="space-y-1.5 pl-6 text-[11px] text-muted-foreground leading-relaxed list-disc marker:text-primary/40">
                <li><span className="text-foreground font-medium">You (the payer)</span> fund the escrow, locking funds on-chain.</li>
                <li>Only you can <span className="text-primary font-medium">release</span> the funds to the recipient.</li>
                <li>The <span className="text-foreground font-medium">recipient</span> can request a <span className="text-destructive font-medium">refund/reversal</span>, returning funds to you.</li>
                <li>You <span className="text-foreground font-medium">cannot self-refund</span>. If you don't release before the timeout, funds auto-return to you.</li>
                <li>Either party can file an <span className="text-orange-400 font-medium">appeal</span> to suspend the escrow for manual arbitration.</li>
              </ul>
            </div>
          )}

          {/* Memo */}
          <div className="space-y-2">
            <Label className="text-sm font-medium text-foreground flex items-center gap-2">
              <FileText className="h-3.5 w-3.5 text-muted-foreground" />
              Memo (optional)
            </Label>
            <Input
              placeholder={
                linkType === "recurring"
                  ? "e.g. Monthly subscription, Donation..."
                  : "Payment for..."
              }
              value={memo}
              onChange={(e) => setMemo(e.target.value)}
              className="bg-secondary border-border text-foreground placeholder:text-muted-foreground text-sm"
              maxLength={100}
            />
          </div>

          {/* Error */}
          {error && (
            <div className="flex items-center gap-2 p-3 rounded-lg bg-destructive/10 border border-destructive/20">
              <AlertCircle className="h-4 w-4 text-destructive flex-shrink-0" />
              <p className="text-xs text-destructive">{error}</p>
            </div>
          )}

          {/* Submit */}
          <Button
            onClick={handleCreate}
            disabled={isCreating || !publicKey}
            className="w-full bg-primary text-primary-foreground hover:bg-emerald-glow font-semibold h-12 text-sm disabled:opacity-50"
          >
            {isCreating ? (
              <Loader2 className="h-4 w-4 animate-spin mr-2" />
            ) : linkType === "recurring" ? (
              <Repeat className="h-4 w-4 mr-2" />
            ) : linkType === "escrow" ? (
              <Shield className="h-4 w-4 mr-2" />
            ) : (
              <Send className="h-4 w-4 mr-2" />
            )}
            {!publicKey
              ? "Connect Wallet to Create"
              : isCreating
              ? linkType === "escrow"
                ? "Creating on-chain..."
                : "Creating..."
              : linkType === "escrow"
              ? "Create Escrow Link"
              : linkType === "recurring"
              ? "Create Recurring Link"
              : "Create Payment Link"}
          </Button>
        </div>
      </div>
    </div>
  );
};

export default CreateLink;