import React from "react";
import { Link, useLocation } from "react-router-dom";
import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";
import { LayoutDashboard, Plus } from "lucide-react";

const Header: React.FC = () => {
  const location = useLocation();

  const navItems = [
    { path: "/", label: "Create", icon: Plus },
    { path: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  ];

  return (
    <header className="sticky top-0 z-50 border-b border-border/50 bg-background/80 backdrop-blur-xl">
      <div className="container flex h-16 items-center justify-between">
        <Link to="/" className="flex items-center gap-2.5 group">
          {/* Logo image — rounded corners built into the SVG, no wrapper box needed */}
          <img
            src="/logo.svg"
            alt="SolSend"
            className="h-9 w-9 rounded-xl object-cover"
          />
          <div className="flex flex-col">
            <span className="text-base font-bold tracking-tight text-foreground leading-none">
              SolSend
            </span>
            <span className="text-[10px] font-medium text-muted-foreground leading-none mt-0.5">
              Payment Links
            </span>
          </div>
        </Link>

        <nav className="hidden sm:flex items-center gap-1">
          {navItems.map(({ path, label, icon: Icon }) => {
            const isActive = location.pathname === path;
            return (
              <Link
                key={path}
                to={path}
                className={`flex items-center gap-2 px-3.5 py-2 rounded-lg text-sm font-medium transition-all ${
                  isActive
                    ? "bg-primary/10 text-primary border border-primary/20"
                    : "text-muted-foreground hover:text-foreground hover:bg-secondary"
                }`}
              >
                <Icon className="h-4 w-4" />
                {label}
              </Link>
            );
          })}
        </nav>

        <WalletMultiButton />
      </div>
    </header>
  );
};

export default Header;
