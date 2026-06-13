# Sponsor & track strategy

Brand-new project (no Continuity tracks). Max 3 sponsors. World banned. Chainlink (CRE /
Confidential AI) and Unlink ("Add Privacy") avoided — taken by a strong contact.

**Apply to 2 sponsors and go deep, with ENS as an optional stretch third.**

## Primary: Hedera (sponsor #1) — $12,000 addressable

The single highest-leverage decision is the **pure-HTS / no-Solidity architecture**: one
codebase competes for all three reachable Hedera tracks. A Solidity vault would forfeit two of
them.

| Track | $ | Qualifies | How Wafer hits it |
|---|---|---|---|
| **Tokenization on Hedera** | $3,000 (2×$1,500) | ✅ lead with this | HTS fungible pool-share (tokenized RWA fund share) + claim NFTs, managed via SDK. Hits the bonus list directly: **KYC-gated fund shares** (their literal example), freeze/pause keys, **custom fractional fee** (protocol take-rate). |
| **No Solidity Allowed** | $3,000 (3×$1,000) | ✅ near-free | SDK-only by construction. Combines **3** native services: HTS + HCS (NAV/audit topic) + Scheduled Transactions (reward sweep); Mirror Node is the read layer. |
| **AI & Agentic Payments** | $6,000 (2×$3,000) | ⚠️ stretch | Add an autonomous **settlement agent** (Hedera Agent Kit, LangChain/TS) that monitors the HCS topic + incoming USDC, routes operator rewards into the vault, recomputes/publishes NAV, mints/burns on deposit/redeem. Qualifies if it demonstrably executes a transfer on testnet. Scope as a thin autonomous loop over SDK calls you already have (`src/agent/`). |
| ~~Autonomous On-Chain Automation~~ | $3,000 | ❌ | Continuity-only. Skip. |

Lead the whole submission with Tokenization; the page does not explicitly confirm one project
can win multiple Hedera bounties, so submit to all three but make Tokenization the primary
narrative.

## Secondary: Privy (sponsor #2) — $3,750 addressable

Chain-agnostic; doesn't need to run on Hedera natively. Use it purely for **auth + embedded
wallet + funding UX**, keep settlement on Hedera HTS.

| Track | $ | How |
|---|---|---|
| Best onchain financial product | $1,250 | Embedded-wallet login + the NAV-vault UI (deposit USDC → hold appreciating share → redeem at NAV). Mirrors Privy's Earn UX with **our own** vault calls. |
| Best cross-chain funding experience | $1,250 | Privy **universal deposit addresses** as the "fund your pool position in one tap" funnel (bridges inbound funds via Relay). |
| Best AI agent built with Privy | $1,250 | Front the settlement agent with a Privy Agent Wallet — reuses the exact agent built for Hedera's agentic track. |

Integration plan (in `web/`):
- Privy embedded wallet on **Hedera EVM** via `defineChain({ id: 296, rpcUrls:
  ['https://testnet.hashio.io/api'], nativeCurrency: HBAR, blockExplorer: hashscan testnet })`,
  set as `defaultChain` + in `supportedChains`.
- **Sharp edge — HTS association**: EVM wallets don't understand HTS token association. On
  first login, the backend sends a dust HBAR transfer to auto-create the account and enables
  auto-association (`maxAutomaticTokenAssociations`). Embedded wallet signs redeem/transfer
  intents; the backend does the HTS heavy lifting. **Test this first thing** — it's the most
  likely thing to silently break the investor demo.
- **Do NOT** chase Privy "Earn" (managed ERC-4626, Base-only, sales-gated) — a pure-HTS vault
  has no on-chain `deposit()/redeem()` to bind to. Hand-roll the UX.

## Optional stretch: ENS (sponsor #3, only with spare capacity)

ENS is not deployed on Hedera, so it reads as a bolt-on unless built into onboarding. Plausible
angle: each operator/fleet gets an ENS subname with text records (network, risk class,
expected rewards, claim-NFT pointer) = portable operator identity; optionally name the
settlement agent (ENS suggests naming AI agents). Targets **Most Creative Use of ENS**
($5,000) + the ENS×AI-agent prize. Only if it doesn't cannibalize the Hedera agentic build.

## Dropped (and why)

| Sponsor | Reason |
|---|---|
| **LI.FI** | No Hedera support (no chain entry, only Hashport which LI.FI doesn't aggregate). A Composer flow can't reach an HTS vault. |
| **Blink** | No Hedera support (Base/Arbitrum/Eth/Polygon/BNB/Solana only). Deposit can't land on Hedera. |
| **Dynamic** | Redundant with Privy (both wallet/auth), worse Hedera fit (EVM-RPC only), and its headline private-nanopayments track is joint with Unlink (avoided). |

## Prize math

- **Two-sponsor addressable** (Continuity excluded): Hedera $12,000 + Privy $3,750 = **$15,750**.
- With ENS stretch: + ~$2.5k–$4k realistic from Most Creative Use / ENS×AI.
- **Realistic expectation** (these are "up to N teams" splits): a focused submission most
  plausibly lands Tokenization ($1,500) + No Solidity ($1,000) + one Privy track ($1,250) ≈
  **$2,500–$3,750**, with genuine upside to ~$6k–$9k if the agentic build lands a $3k Hedera
  agent slot. The pure-HTS architecture choice is what unlocks 3 Hedera tracks from one build —
  worth more expected value than adding any third wallet/bridge sponsor.

Sources: ETHGlobal NY 2026 prize pages (Hedera, Privy, ENS), Hedera/Circle/Privy/SaucerSwap
docs — see research notes in the project thread.
