import React, { useMemo, useState, useEffect, useCallback } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { Link, useNavigate } from "react-router-dom";
import {
  LayoutDashboard,
  Plus,
  Clock,
  Coins,
  AlertCircle,
  Send,
  Shield,
  Repeat,
  Infinity,
  CalendarClock,
  Loader2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { getLinksByWallet } from "@/lib/linkStore";
import {
  shortenAddress,
  getStatusColor,
  getStatusLabel,
  getTypeLabel,
  getTypeColor,
  getExpiryLabel,
  TOKEN_LABELS,
} from "@/lib/types";
import type { PaymentLink } from "@/lib/types";

const StatCard: React.FC<{
  label: string;
  value: string | number;
  icon: React.ReactNode;
}> = ({ label, value, icon }) => (
  <div className="glass-card p-4">
    <div className="flex items-center justify-between mb-2">
      <span className="text-[11px] text-muted-foreground uppercase tracking-wider font-medium">
        {label}
      </span>
      <div className="text-muted-foreground">{icon}</div>
    </div>
    <p className="text-2xl font-bold text-foreground">{value}</p>
  </div>
);

const LinkRow: React.FC<{ link: PaymentLink; walletAddress: string }> = ({
  link,
  walletAddress,
}) => {
  const navigate = useNavigate();
  const isSender = link.creator === walletAddress;

  return (
    <button
      onClick={() => navigate(`/pay/${link.id}`)}
      className="w-full flex items-center gap-4 p-4 rounded-lg bg-secondary/50 border border-border hover:bg-secondary transition-colors text-left"
    >
      <div className="flex h-9 w-9 items-center justify-center rounded-lg flex-shrink-0 bg-primary/10 border border-primary/20">
        {link.type === "recurring" ? (
          <Repeat className="h-4 w-4 text-primary" />
        ) : link.type === "escrow" ? (
          <Shield className="h-4 w-4 text-primary" />
        ) : (
          <Send className="h-4 w-4 text-primary" />
        )}
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-0.5 flex-wrap">
          <span className="text-sm font-semibold text-foreground">
            {link.allowCustomAmount
              ? `Any ${TOKEN_LABELS[link.tokenType]}`
              : `${link.amount} ${TOKEN_LABELS[link.tokenType]}`}
          </span>
          <span
            className={`px-2 py-0.5 rounded-full text-[10px] font-semibold ${getStatusColor(
              link.status
            )}`}
          >
            {getStatusLabel(link.status)}
          </span>
          <span
            className={`text-[10px] px-1.5 py-0.5 rounded font-semibold ${getTypeColor(
              link.type
            )}`}
          >
            {getTypeLabel(link.type).toUpperCase()}
          </span>
        </div>
        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          <span>
            {isSender ? "To" : "From"}{" "}
            <span className="font-mono">
              {shortenAddress(isSender ? link.recipient : link.creator)}
            </span>
          </span>
          {link.type === "recurring" && (
            <span className="flex items-center gap-1">
              <Coins className="h-3 w-3" />
              {link.payments?.length || 0} payments
            </span>
          )}
          {link.expiresAt ? (
            <span className="flex items-center gap-1">
              <CalendarClock className="h-3 w-3" />
              {getExpiryLabel(link.expiresAt)}
            </span>
          ) : (
            <span className="flex items-center gap-1 text-primary">
              <Infinity className="h-3 w-3" />
              Infinite
            </span>
          )}
        </div>
      </div>

      <div className="text-right flex-shrink-0 hidden sm:block">
        <p className="text-[11px] text-muted-foreground">
          {new Date(link.createdAt).toLocaleDateString()}
        </p>
        {link.type === "recurring" && (
          <p className="text-[11px] text-primary font-medium">
            {link.totalReceived || 0} {TOKEN_LABELS[link.tokenType]}
          </p>
        )}
      </div>
    </button>
  );
};

const Dashboard: React.FC = () => {
  const { publicKey } = useWallet();
  const [links, setLinks] = useState<PaymentLink[]>([]);
  const [loading, setLoading] = useState(false);

  const fetchLinks = useCallback(async () => {
    if (!publicKey) return;
    setLoading(true);
    try {
      const data = await getLinksByWallet(publicKey.toBase58());
      setLinks(data);
    } finally {
      setLoading(false);
    }
  }, [publicKey]);

  useEffect(() => {
    fetchLinks();
  }, [fetchLinks]);

  const stats = useMemo(() => {
    const oneTime = links.filter((l) => l.type === "one-time").length;
    const recurring = links.filter((l) => l.type === "recurring").length;
    const escrow = links.filter((l) => l.type === "escrow").length;
    const active = links.filter(
      (l) =>
        l.status === "active" ||
        l.status === "pending" ||
        l.status === "funded" ||
        l.status === "appealed"
    ).length;
    const totalReceived = links.reduce((sum, l) => sum + (l.totalReceived || 0), 0);
    return { total: links.length, oneTime, recurring, escrow, active, totalReceived };
  }, [links]);

  if (!publicKey) {
    return (
      <div className="glass-card p-8 max-w-lg mx-auto text-center animate-fade-in">
        <AlertCircle className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
        <h2 className="text-lg font-bold text-foreground mb-2">Connect Your Wallet</h2>
        <p className="text-sm text-muted-foreground">
          Connect your Solana wallet to view your payment links.
        </p>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="animate-fade-in space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 border border-primary/20">
            <LayoutDashboard className="h-5 w-5 text-primary" />
          </div>
          <div>
            <h2 className="text-lg font-bold text-foreground">Dashboard</h2>
            <p className="text-xs text-muted-foreground font-mono">
              {shortenAddress(publicKey.toBase58(), 6)}
            </p>
          </div>
        </div>
        <Link to="/">
          <Button className="bg-primary text-primary-foreground hover:bg-emerald-glow font-semibold text-sm">
            <Plus className="h-4 w-4 mr-1.5" />
            New Link
          </Button>
        </Link>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatCard label="Total" value={stats.total} icon={<Coins className="h-4 w-4" />} />
        <StatCard
          label="Active"
          value={stats.active}
          icon={<Clock className="h-4 w-4" />}
        />
        <StatCard
          label="Recurring"
          value={stats.recurring}
          icon={<Repeat className="h-4 w-4" />}
        />
        <StatCard
          label="Escrow"
          value={stats.escrow}
          icon={<Shield className="h-4 w-4" />}
        />
      </div>

      {/* Link List */}
      <div className="glass-card p-5">
        <h3 className="text-sm font-semibold text-foreground mb-4">
          Your Payment Links ({links.length})
        </h3>

        {links.length === 0 ? (
          <div className="text-center py-12">
            <Coins className="h-10 w-10 text-muted-foreground/40 mx-auto mb-3" />
            <p className="text-sm text-muted-foreground mb-4">
              No payment links yet. Create your first one.
            </p>
            <Link to="/">
              <Button
                variant="outline"
                className="border-border text-foreground hover:bg-secondary text-sm"
              >
                <Plus className="h-4 w-4 mr-1.5" />
                Create Link
              </Button>
            </Link>
          </div>
        ) : (
          <div className="space-y-2">
            {links.map((link) => (
              <LinkRow
                key={link.id}
                link={link}
                walletAddress={publicKey.toBase58()}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default Dashboard;