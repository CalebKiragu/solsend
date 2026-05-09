import React from "react";
import { motion } from "framer-motion";
import { Shield, Send, Link2, Clock, Coins, Repeat } from "lucide-react";

const features = [
  {
    icon: Link2,
    title: "Payment Links",
    desc: "Share links, accept SOL & USDC instantly",
  },
  {
    icon: Repeat,
    title: "Recurring Links",
    desc: "Accept unlimited payments on one link",
  },
  {
    icon: Shield,
    title: "Escrow Mode",
    desc: "On-chain escrow with release controls",
  },
  {
    icon: Clock,
    title: "Expiry Control",
    desc: "Set expiry dates or keep links infinite",
  },
];

const HeroSection: React.FC = () => {
  return (
    <div className="relative mb-10">
      {/* Glow effect */}
      <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
        <div className="w-[500px] h-[300px] rounded-full bg-primary/5 blur-[100px]" />
      </div>

      <div className="relative text-center mb-8">
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
        >
          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-primary/10 border border-primary/20 mb-5">
            <div className="h-1.5 w-1.5 rounded-full bg-primary animate-pulse" />
            <span className="text-xs font-medium text-primary">
              Built on Solana Devnet
            </span>
          </div>
        </motion.div>

        <motion.h1
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.1 }}
          className="text-3xl sm:text-4xl lg:text-5xl font-extrabold tracking-tight text-foreground mb-4"
        >
          Accept Payments
          <br />
          <span className="text-primary">with SolSend</span>
        </motion.h1>

        <motion.p
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.2 }}
          className="text-base text-muted-foreground max-w-lg mx-auto"
        >
          Create shareable payment links for your website or business.
          One-time, recurring, or escrow-protected. SOL & USDC supported.
        </motion.p>
      </div>

      {/* Feature Pills */}
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, delay: 0.3 }}
        className="grid grid-cols-2 sm:grid-cols-4 gap-3 max-w-2xl mx-auto mb-8"
      >
        {features.map(({ icon: Icon, title, desc }) => (
          <div
            key={title}
            className="glass-card p-3 text-center group hover:border-primary/20 transition-colors"
          >
            <Icon className="h-5 w-5 text-primary mx-auto mb-2 group-hover:scale-110 transition-transform" />
            <p className="text-xs font-semibold text-foreground mb-0.5">{title}</p>
            <p className="text-[10px] text-muted-foreground leading-relaxed">{desc}</p>
          </div>
        ))}
      </motion.div>
    </div>
  );
};

export default HeroSection;
