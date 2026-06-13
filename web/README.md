# Wafer frontend (Privy + Hedera EVM)

Investor-facing dApp. Scaffolded separately to keep the backend install light. Build it here
during the 24–36h window (see `docs/TRACKS.md` for the Privy strategy).

## Stack

- Next.js (App Router) + React
- `@privy-io/react-auth` — embedded wallet + email login
- `viem` / `ethers` against the Hedera EVM relay (chain id **296**, `https://testnet.hashio.io/api`)
- Reads NAV/TVL/holders straight from the Mirror Node REST API (no backend dependency)

## Init

```bash
cd web
pnpm create next-app@latest . --ts --app --eslint --src-dir --use-pnpm
pnpm add @privy-io/react-auth viem
```

## Privy on Hedera testnet (the key snippet)

```ts
import { defineChain } from "viem";

export const hederaTestnet = defineChain({
  id: 296,
  name: "Hedera Testnet",
  nativeCurrency: { name: "HBAR", symbol: "HBAR", decimals: 18 }, // EVM-side decimals
  rpcUrls: { default: { http: ["https://testnet.hashio.io/api"] } },
  blockExplorers: { default: { name: "HashScan", url: "https://hashscan.io/testnet" } },
});

// <PrivyProvider config={{ defaultChain: hederaTestnet, supportedChains: [hederaTestnet] }}>
```

## The sharp edge — test this FIRST

EVM wallets don't understand HTS **token association**. On first login the backend must:
1. send a dust HBAR transfer to the new wallet's EVM-address alias (auto-creates the Hedera
   account + covers gas), and
2. ensure share/USDC association (auto-association slots, or associate on the user's behalf).

Validate that a brand-new Privy embedded wallet can receive HTS shares and then sign an
outbound redeem on chain 296 before building any UI on top. See `docs/TRACKS.md`.

## Screens (MVP)

- Pool card: NAV (live from HCS via Mirror Node), TVL, your balance + value.
- Deposit: approve/send USDC → receive shares.
- Redeem: shares → USDC at NAV.
- Activity: the HCS event feed (deposits, sweeps, settlements) = the verifiable audit trail.
