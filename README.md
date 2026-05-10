# SolSend — Shareable Payment Links on Solana

> Create and share payment links for SOL and USDC. One-time, recurring, or escrow-protected — no code required.

**Live Demo:** [solsend-seven.vercel.app](https://solsend-seven.vercel.app)  
**Network:** Solana Devnet  
**Program ID:** `129TM1kMKESrr3rVGsd8ca3L8FtQPHd5KzHVsrzFqN4x`

---

## What is SolSend?

SolSend lets anyone with a Solana wallet generate a shareable payment link in seconds. The link can be sent over email, embedded on a website, or shared on social media. The recipient opens the link, connects their wallet, and pays — no app download, no account creation.

Three link types are supported:

| Type | Use case |
|------|----------|
| **One-time** | Request a single fixed payment (invoice, tip, donation) |
| **Recurring** | Accept unlimited payments on one link (subscriptions, storefronts) |
| **Escrow** | Lock funds on-chain with controlled release (freelance, trades, deals) |

---

## Features

### Payment Links
- Generate a unique `/pay/:id` URL for any payment request
- Fixed amount or custom amount (payer decides)
- SOL and USDC (SPL token) support
- Optional expiry — set a deadline or keep the link active forever
- Payment history tracked per link

### Escrow
- Payer funds a deterministic vault address derived from creator + recipient + nonce
- Only the payer can release funds to the recipient
- Recipient can request a refund/reversal at any time
- Optional auto-refund timeout (15 min → 7 days)
- Either party can file an appeal to suspend the escrow for arbitration
- Full role-based UI — the page adapts based on whether you are the payer or recipient

### Dashboard
- View all links associated with your wallet (as creator or recipient)
- Live status badges: Active, Pending, Funded, Released, Refunded, Expired, Under Appeal
- Payment history with Solana Explorer links for every transaction
- Stats overview: total links, active, recurring, escrow counts

### Infrastructure
- **Supabase** for persistent link storage — links are accessible from any device, not just the browser that created them
- **localStorage** as a read-through cache for instant load on repeat visits
- Graceful fallback to localStorage if Supabase is unavailable

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 18, TypeScript, Vite |
| Styling | Tailwind CSS, shadcn/ui, Framer Motion |
| Blockchain | Solana Web3.js, Anchor, `@solana/wallet-adapter` |
| Wallet | Phantom (via `@solana/wallet-adapter-phantom`) |
| Smart Contract | Anchor (Rust), deployed on Solana Devnet |
| Database | Supabase (PostgreSQL + Row Level Security) |
| Hosting | Vercel |

---

## Project Structure

```
solsend/
├── src/
│   ├── components/
│   │   ├── CreateLink.tsx      # Link creation form (all three types)
│   │   ├── Dashboard.tsx       # Wallet dashboard with link list and stats
│   │   ├── Header.tsx          # Navigation bar with wallet connect button
│   │   ├── HeroSection.tsx     # Landing page hero
│   │   ├── LinkDetail.tsx      # Pay page — role-aware actions for each link type
│   │   └── ui/                 # shadcn/ui component library
│   ├── hooks/
│   │   ├── useEscrowSDK.ts     # Anchor provider + SDK instantiation hook
│   │   └── use-toast.ts        # Toast notification hook
│   ├── lib/
│   │   ├── types.ts            # All shared TypeScript types and utility functions
│   │   ├── linkStore.ts        # Async data layer — Supabase primary, localStorage fallback
│   │   ├── supabase.ts         # Supabase client initialisation
│   │   ├── escrowProgram.ts    # Direct SOL/SPL transfer transaction builders
│   │   ├── solpayEscrow.ts     # Anchor SDK wrapper for the on-chain escrow program
│   │   └── configAddress.ts    # Program ID and config constants
│   ├── pages/
│   │   ├── Index.tsx           # Landing page (hero + create link form)
│   │   ├── DashboardPage.tsx   # Dashboard page wrapper
│   │   ├── PayPage.tsx         # Payment/escrow detail page wrapper
│   │   └── NotFound.tsx        # 404 page
│   ├── idl/
│   │   └── workspaceIDL.json   # Anchor IDL for the deployed escrow program
│   ├── App.tsx                 # Router, wallet providers, route definitions
│   └── main.tsx                # Entry point — Buffer polyfill, BrowserRouter
├── contracts/
│   └── programs/workspace/
│       └── src/lib.rs          # Anchor smart contract (Rust)
├── vercel.json                 # SPA rewrite rule for client-side routing
└── .npmrc                      # legacy-peer-deps for Solana wallet adapter deps
```

---

## Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/) v18 or later
- [Phantom Wallet](https://phantom.app/) browser extension
- A [Supabase](https://supabase.com) project (free tier works)

### 1. Clone the repository

```bash
git clone https://github.com/CalebKiragu/solsend.git
cd solsend
```

### 2. Install dependencies

```bash
npm install
```

### 3. Set up environment variables

Create a `.env` file in the project root:

```env
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key
```

Both values are in your Supabase project under **Settings → API**.

> The app works without Supabase — it falls back to localStorage automatically. Links will only be visible on the device that created them in that case.

### 4. Set up the Supabase database

In your Supabase project, open the **SQL Editor** and run:

```sql
create table if not exists payment_links (
  id                  text primary key,
  type                text not null,
  creator             text not null,
  recipient           text not null,
  amount              numeric not null default 0,
  allow_custom_amount boolean not null default false,
  token_type          text not null,
  token_mint          text,
  status              text not null,
  memo                text,
  created_at          timestamptz not null,
  link_url            text not null,
  expires_at          timestamptz,
  payments            jsonb not null default '[]',
  total_received      numeric not null default 0,
  escrow_pda          text,
  nonce               text,
  timeout_seconds     integer,
  funded_at           timestamptz,
  released_at         timestamptz,
  refunded_at         timestamptz,
  appealed_at         timestamptz,
  appealed_by         text,
  paid_at             timestamptz,
  tx_signature        text
);

create index if not exists idx_payment_links_creator   on payment_links (creator);
create index if not exists idx_payment_links_recipient on payment_links (recipient);

alter table payment_links enable row level security;

create policy "public read"    on payment_links for select using (true);
create policy "creator insert" on payment_links for insert with check (true);
create policy "creator update" on payment_links for update using (true);
```

### 5. Start the development server

```bash
npm run dev
```

Open [http://localhost:5173](http://localhost:5173) in your browser.

### 6. Switch Phantom to Devnet

In Phantom: **Settings → Developer Settings → Change Network → Devnet**

Get devnet SOL from the [Solana faucet](https://faucet.solana.com/).

---

## How It Works

### Creating a Payment Link

1. Connect your Phantom wallet
2. Choose a link type: One-time, Recurring, or Escrow
3. Enter the recipient address, amount, token (SOL/USDC), and optional memo
4. For recurring links, optionally allow custom amounts and set an expiry
5. For escrow links, optionally set an auto-refund timeout
6. Click **Create** — the link is saved to Supabase and a shareable URL is generated

### Paying a Link

Anyone with the link URL can open it in a browser, connect their wallet, and pay. The page automatically detects the link type and shows the appropriate action:

- **One-time**: single Pay button, marks the link completed after payment
- **Recurring**: Pay button, supports custom amounts, records each payment in history
- **Escrow**: role-aware — payer sees Fund/Release/Appeal, recipient sees Refund/Appeal

### Escrow Flow

```
Creator creates link  →  shares URL with recipient
         ↓
Payer (creator) opens link  →  clicks "Fund Escrow"
         ↓
SOL/USDC sent to deterministic vault address on-chain
         ↓
         ├── Payer satisfied  →  clicks "Release"  →  funds sent to recipient
         ├── Recipient unhappy  →  clicks "Refund"  →  funds returned to payer
         ├── Timeout elapsed  →  auto-refund to payer
         └── Dispute  →  either party files "Appeal"  →  escrow suspended
```

The vault address is a Program Derived Address (PDA) computed from `[b"solsend-escrow", creator, recipient, nonce]` using `SystemProgram.programId`. Funds genuinely sit on-chain at this address and are verifiable on [Solana Explorer](https://explorer.solana.com/?cluster=devnet).

---

## Smart Contract

The Anchor program at `129TM1kMKESrr3rVGsd8ca3L8FtQPHd5KzHVsrzFqN4x` (Devnet) implements:

| Instruction | Description |
|-------------|-------------|
| `initialize_config` | Set platform fee (basis points) and reserve address |
| `create_escrow` | Create an escrow state account with PDA seeds `[escrow, creator, nonce]` |
| `fund_escrow_sol` | Transfer SOL from creator to vault PDA |
| `fund_escrow_spl` | Transfer SPL tokens from creator to escrow token account |
| `release_escrow_sol` | Release SOL from vault to recipient (creator only) |
| `release_escrow_spl` | Release SPL tokens to recipient (creator only) |
| `refund_escrow_sol` | Return SOL to creator after timeout (permissionless) |
| `refund_escrow_spl` | Return SPL tokens to creator after timeout (permissionless) |

### Building and deploying the contract

```bash
cd contracts

# Install Anchor CLI
cargo install --git https://github.com/coral-xyz/anchor avm --locked
avm install latest && avm use latest

# Build
anchor build

# Deploy to devnet
anchor deploy --provider.cluster devnet
```

After deploying, update `src/lib/configAddress.ts` with the new program ID and regenerate the IDL:

```bash
anchor idl fetch 129TM1kMKESrr3rVGsd8ca3L8FtQPHd5KzHVsrzFqN4x \
  --provider.cluster devnet > src/idl/workspaceIDL.json
```

---

## Deployment

The app is deployed on Vercel. The `vercel.json` rewrite rule ensures all routes serve `index.html` so client-side navigation works correctly:

```json
{
  "rewrites": [{ "source": "/(.*)", "destination": "/index.html" }]
}
```

To deploy your own instance:

1. Fork the repository
2. Import it into [Vercel](https://vercel.com)
3. Add the environment variables in **Project Settings → Environment Variables**:
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY`
4. Deploy

---

## Available Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Start development server on port 5173 |
| `npm run build` | Production build to `dist/` |
| `npm run preview` | Preview the production build locally |
| `npm run lint` | Run ESLint |

---

## Contributing

Contributions are welcome. Here's how to get started:

1. Fork the repo and create a feature branch: `git checkout -b feat/your-feature`
2. Make your changes and ensure the build passes: `npm run build`
3. Commit with a descriptive message following conventional commits
4. Open a pull request against `main`

### Areas open for contribution

- **Mainnet support** — switch network config and update token mint addresses
- **More wallet adapters** — Solflare, Backpack, Ledger
- **USDC faucet integration** — auto-request devnet USDC for testing
- **Email/webhook notifications** — notify recipient when a link is funded
- **QR code generation** — for point-of-sale use cases
- **Multi-token support** — add more SPL tokens beyond USDC
- **On-chain escrow migration** — re-enable the Anchor program once devnet accounts are cleared
- **Mobile responsiveness improvements**

---

## Known Limitations

- **Devnet only** — the app currently runs on Solana Devnet. Mainnet support requires updating the network config and token mint addresses.
- **Escrow is trust-based** — the current escrow implementation uses direct wallet transfers tracked in Supabase. The on-chain Anchor program exists and is deployed but is not used for the fund/release flow due to devnet account state constraints. A production deployment would use the full Anchor program.
- **No arbitration mechanism** — the appeal feature suspends the escrow in the UI but does not trigger any on-chain or off-chain arbitration process. This is a placeholder for a future dispute resolution system.
- **localStorage fallback** — without Supabase credentials, links are only visible on the device that created them.

---

## License

MIT — see [LICENSE](LICENSE) for details.
