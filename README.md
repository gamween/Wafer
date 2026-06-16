<div align="center">

# 🗽 Wafer

**InfraFi liquidity for DePIN — a KYC-gated, NAV-appreciating tokenized credit fund on Hedera.**

[![Live Demo](https://img.shields.io/badge/demo-wafer--steel.vercel.app-000?style=flat-square)](https://wafer-steel.vercel.app/)
[![Hedera Testnet](https://img.shields.io/badge/Hedera-Testnet%20(296)-7c3aed?style=flat-square)](https://hashscan.io/testnet/contract/0x8Fb4439f76ea7eAa6DcE88751A20981a796fb311)
[![Sourcify](https://img.shields.io/badge/Sourcify-verified-2ecc71?style=flat-square)](https://repo.sourcify.dev/contracts/full_match/296/0x8Fb4439f76ea7eAa6DcE88751A20981a796fb311/)
[![Solidity](https://img.shields.io/badge/Solidity-0.8.24-363636?style=flat-square)](https://soliditylang.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg?style=flat-square)](LICENSE)

🏆 **Winner — Tokenization on Hedera ($1,500) · ETHGlobal New York 2026**

[Live app](https://wafer-steel.vercel.app/) · [Contract on HashScan](https://hashscan.io/testnet/contract/0x8Fb4439f76ea7eAa6DcE88751A20981a796fb311) · [Verified source](https://repo.sourcify.dev/contracts/full_match/296/0x8Fb4439f76ea7eAa6DcE88751A20981a796fb311/)

</div>

Wafer turns the future on-chain rewards of physical infrastructure (DePIN) into liquid, on-chain
yield. Operators get HBAR today against the rewards their hardware will earn; investors hold a
fungible, KYC-gated, NAV-appreciating fund share whose value rises live as those rewards stream back
in. It's Centrifuge / Maple, specialized for DePIN — built end-to-end on the **Hedera Token Service**.

> 🏆 **Winner of the "Tokenization on Hedera" bounty at [ETHGlobal New York 2026](https://ethglobal.com/events/newyork2026).**
> Out of the field, the **Hedera** team selected Wafer for taking a genuine real-world asset — a DePIN
> operator's *future on-chain rewards* — and turning it into a compliant, **KYC-gated tokenized fund
> share** with a full on-chain credit lifecycle (finance → reward → NAV↑ → repaid / default) and
> **HIP-1215 scheduled settlement** — all live and Sourcify-verified on Hedera Testnet, no slideware.
> The bounty rewarded real-world-asset tokenization on HTS with *meaningful compliance and lifecycle
> management*; Wafer was built to be exactly that, end to end.

> [!NOTE]
> The exact repository submitted to ETHGlobal New York 2026 is
> [`aiden-fianso/Wafer`](https://github.com/aiden-fianso/Wafer) (frozen at submission). This
> repository is the continued, post-hackathon development of the project.

## Table of contents

- [Why DePIN](#why-depin)
- [How it works](#how-it-works)
- [Architecture](#architecture)
- [Hedera Token Service](#hedera-token-service)
- [What's live vs. roadmap](#whats-live-vs-roadmap)
- [Tech stack](#tech-stack)
- [Repository structure](#repository-structure)
- [Getting started](#getting-started)
- [Deployed addresses](#deployed-addresses)
- [Security & testing](#security--testing)
- [License](#license)

## Why DePIN

DePIN (Decentralized Physical Infrastructure) operators — GPU/compute, wireless, mapping, energy,
storage — buy hardware **today** but earn protocol rewards **over months**. That timing gap is
capital they don't have, and legacy credit can't underwrite a stream of on-chain rewards.

What makes DePIN the ideal real-world asset for on-chain credit:

> DePIN cashflow is **natively on-chain** — no invoice, no bank, no fiat bridge. Repayment needs no
> trust in a human paying back: the operator escrows its **device-NFT** (the on-chain object that
> controls where rewards are deposited, e.g. Helium's `recipient/destination` model), so the hardware
> routes its rewards straight to the vault. The fund's NAV ticks up live as they land.

## How it works

```
Operator proposes a deal
   └─▶ 1. Admin assigns a risk class (A/B/C) + routes it to a pool
       └─▶ 2. Pool finances: advances HBAR + escrows the device-NFT + mints a claim NFT (the receipt)
           └─▶ 3. Rewards stream in → NAV per share rises (amortized-cost accrual)
               └─▶ 4a. Repaid in full  → claim NFT burns, device-NFT returned
                   4b. Default          → NAV writes down, loss shared pro-rata, collateral retained
```

- **Pools** are standardized by **category × risk class** (e.g. `GPU-A`). The pool share is a
  **NAV-appreciating** unit (ERC-4626-like): NAV rises only as *realized* reward spread is accreted
  over each deal's term. `totalAssets` is derived (`idle cash + receivable`), which structurally kills
  the classic double-count bug (deposit 100, advance 90, repay 100 must never read NAV 2.0).
- **Investors** exit any time: redeem at NAV (instant up to the liquidity buffer, remainder
  FIFO-queued) or sell on a live **SaucerSwap** share/WHBAR market.
- The advance itself is a **locked transfer** released by the Hedera network on a schedule (HIP-1215)
  — no off-chain keeper.

## Architecture

```
        operator ──propose / escrow / route──▶┌──────────────────────────────────────┐◀──deposit / redeem── investor
                                              │      WaferVault.sol  (Hedera EVM)     │
   admin ──approve / assign-class / finance──▶│   via @hiero-ledger/hiero-contracts:  │
                                              │   • HTS pool-share  (KYC+freeze+pause) │
   settler ──settleRewards (reward HBAR)─────▶│   • HTS claim-NFT   (deal receipt)     │
                                              │   • device-NFT escrow (collateral)     │
   MockRewardSource (sim. cashflow) ─────────▶│   • amortized-cost NAV, deposit/redeem │
                                              │   • finance / settle / default / queue │
   React + Vite + viem  ──reads/writes───────▶└──────┬───────────────────┬─────────────┘
   (deployed on Vercel)                              │ HTS @ 0x167        │ share / WHBAR
                                          ┌──────────▼───────┐   ┌────────▼─────────┐
                                          │ Hedera Token Svc  │   │  SaucerSwap V1   │  secondary market
                                          │ Schedule Svc 0x16b│   └──────────────────┘
                                          └──────────┬───────┘
                                                     │ logs / balances
                                          ┌──────────▼───────┐
                                          │   Mirror Node    │──▶ frontend feed + on-chain audit
                                          └──────────────────┘
```

The vault **is** the backend: all money logic lives on-chain and is verifiable. No HTTP API, no
database — contract events and the Hedera Mirror Node are the read/audit layer.

## Hedera Token Service

Wafer was built for the **🪙 Tokenization on Hedera** track: a tokenized fund share as a real-world
asset representation, with compliance and lifecycle management at the protocol level.

| Qualification requirement | Status |
|---|---|
| Create / manage tokens via the **Hedera Token Service** (SDK or system contracts) | ✅ HTS system contracts (`0x167`) |
| Deployed & demonstrated on **Hedera Testnet** | ✅ `0x8Fb4439f…fb311` |
| Public GitHub repository | ✅ this repo |
| Contracts **verified** (HashScan / Sourcify) | ✅ Sourcify full match |
| ≤ 5-min demo: creation, configuration, a lifecycle operation | ✅ full lifecycle (finance → reward → NAV↑ → repaid/burn → default) |

| Optional enhancement | Status |
|---|---|
| Use **`@hiero-ledger/hiero-contracts`** for HTS system-contract imports | ✅ |
| Compliance controls: KYC grants, account freeze, token pause | ✅ all three, enforced at the token level (5-key share: supply/kyc/freeze/wipe/pause) |
| Scheduled token operations (vesting/distributions) via Hedera Scheduled Transactions | ✅ HIP-1215: locked advance payout + maturity settlement, keeper-free |
| Custom fee schedules (fixed / fractional / royalty) | 🛣️ roadmap — *see note* |
| Cross-chain (LayerZero / CCIP / HashPort) | 🛣️ roadmap |
| Oracle integration (Chainlink / Pyth / Supra) | 🛣️ roadmap |

> **On custom fees (a deliberate omission, not a miss):** on Hedera a fractional custom fee is
> assessed on every non-collector transfer and reverts `INVALID_ACCOUNT_ID` on a KYC-gated token,
> which breaks both `redeem` (operator→vault) and the SaucerSwap AMM. A compliant protocol take-rate
> therefore needs a permissioned-transfer design — on the roadmap rather than shipped broken.

## What's live vs. roadmap

Wafer is a **hackathon-stage product with production foundations in place**. The architecture, roles,
state machines, and on-chain primitives for the full system already exist; what remains for production
is wiring real-world data sources and decentralizing the trusted control surface. Nothing below is
faked — the hooks are in the contract and surfaced in the UI.

### Live on Hedera Testnet today

- **Tokenized fund share** — a real HTS fungible token, 8-decimal, treasury and keys held by the vault
  contract (no off-chain signer), redeemable at NAV.
- **Compliance, enforced on-chain** — KYC grant/revoke, per-account freeze, and **token-level pause**
  (`pauseToken`), all wired to the HTS token keys.
- **Full credit lifecycle** — proposal → approval → finance (HBAR advance + device-NFT escrow +
  claim-NFT mint) → amortized-cost settlement → repaid (NFT burn) / default (NAV write-down).
- **Scheduled transactions (HIP-1215)** — the advance is locked and released by the network on a
  schedule; reward settlement is network-scheduled. No keeper, no cron.
- **Liquidity** — deposit/redeem at NAV with an instant + FIFO-queue model, plus a live **SaucerSwap
  V1** share/WHBAR secondary market enabled per pool in a single contract call.
- **Verifiable** — deployed and **Sourcify-verified**; the frontend reads NAV/pools/deals/activity
  from the contract and the Mirror Node, and is deployed on Vercel.

### Roadmap — designed, foundations in place, not yet productionized

| Area | Foundation today | Production direction |
|---|---|---|
| **Deal underwriting & listing** | An **admin** reviews, risk-classes, and approves each deal before a pool finances it. This is a deliberate v1 control surface to demonstrate the lifecycle end-to-end — *intentionally* centralized for the demo, not an oversight. The on-chain role gating, risk-class enum, and approval state machine are already implemented. | Decentralize underwriting: delegated/permissionless underwriters, on-chain credit scoring from Mirror Node reward history, DAO-governed risk parameters — swapping the human admin for a trust-minimized process, **not** adding new primitives. |
| **KYC / identity** | KYC grant/freeze are real and enforced at the token level; the allowlist is currently admin-driven (`adminGrantKyc`). | Wire an identity/KYC provider (on-chain attestations) to drive the allowlist automatically. |
| **DePIN reward cashflow** | The reward stream is simulated on-chain by `MockRewardSource`; the **routing mechanism** (device-NFT escrow, Helium `recipient/destination` model) and the **settlement** (HIP-1215) are real. | Live per-network reward integrations (Helium / Render / io.net) + an HNT→HBAR bridge relayer (the one residual off-chain trust). |
| **Protocol fees** | None (deliberate — see HTS note above). | Compliant fractional/royalty fee via a permissioned-transfer token design. |
| **Pricing / cross-chain** | — | Oracle-priced NAV (Pyth/Supra) and cross-chain deposits (LayerZero/CCIP/HashPort). |

The mental model: **the primitives are real and on-chain; productionization means replacing trusted
inputs (the admin, the simulated cashflow) with trust-minimized ones — not rebuilding the core.**

## Tech stack

- **Smart contract** — Solidity `0.8.24` on the Hedera Smart Contract Service (EVM, optimizer + `viaIR`).
- **Hedera services** — Hedera Token Service (`0x167`) and Schedule Service / HIP-1215 (`0x16b`) via
  the [`@hiero-ledger/hiero-contracts`](https://www.npmjs.com/package/@hiero-ledger/hiero-contracts)
  system-contract bindings. Settlement in **native HBAR** (8-dp tinybar).
- **Tooling** — Hardhat, `@openzeppelin/contracts` (Ownable2Step, ReentrancyGuard), Sourcify.
- **Frontend** — React 19 + Vite 6 + [viem](https://viem.sh/), MetaMask / EIP-6963, reading the
  **Hedera Mirror Node**. No backend. Deployed on **Vercel**.
- **Secondary market** — SaucerSwap V1 (share/WHBAR).

## Repository structure

```
contracts/
  WaferVault.sol          the vault — HTS tokens + HIP-1215 scheduling, amortized-cost NAV, HBAR-settled
  MockRewardSource.sol    the only simulated piece — the DePIN reward stream (HIP-1215 self-settle)
  MockDeviceNFT.sol       demo device-NFT collection (operator collateral)
scripts/
  deploy.ts               deploy the stack + create the GPU-A pool, persist deployments/testnet.json
  smoke.ts                full lifecycle LIVE on testnet (finance → drip → NAV↑ → repaid/default)
  smoke-hss.ts            HIP-1215 LIVE: locked advance auto-release + scheduled settle
  enable-secondary.ts     fallback SaucerSwap enable flow
  redeploy-mock.ts        redeploy only MockRewardSource against the live vault
  resolve-operator.ts     derive the operator Hedera id from the key (Mirror Node)
test/                     78 pure-logic tests mirroring the contract's exact integer math
web/                      React + Vite + viem frontend (deployed on Vercel)
deployments/testnet.json  canonical on-chain addresses (the frontend auto-syncs from this)
SPEC.md · docs/ONE-PAGER.md · CONTRIBUTING.md   technical spec + one-pager + contributor guide
```

## Getting started

Prerequisites: Node ≥ 22, `pnpm`, and a funded Hedera Testnet ECDSA account.

```bash
pnpm install
cp .env.example .env          # set OPERATOR_ID / OPERATOR_KEY (testnet)

pnpm test                     # 78 pure-logic tests (no network)
pnpm run compile              # hardhat compile

pnpm run deploy               # deploy vault + GPU-A pool + mocks → deployments/testnet.json
pnpm run verify <VAULT_ADDR>  # Sourcify (chain 296)

pnpm run smoke                # full lifecycle live: NAV 1.0 → 1.1, repaid/burn, then a default run
pnpm run smoke:hss            # HIP-1215 live: locked advance + scheduled settle (keeper-free)
```

Run the frontend:

```bash
cd web && pnpm install && pnpm dev   # reads addresses from deployments/testnet.json
```

> Settlement is **native HBAR** — no USDC, no token association for settlement, no faucet bridge.
> `createPool` performs two HTS creates; attach ~100 HBAR (excess is refunded to the contract).

## Deployed addresses

Hedera Testnet (chain 296):

| Contract / token | EVM address | Hedera ID |
|---|---|---|
| **WaferVault** | [`0x8Fb4439f…fb311`](https://hashscan.io/testnet/contract/0x8Fb4439f76ea7eAa6DcE88751A20981a796fb311) | `0.0.9250244` |
| Pool share (HTS, GPU-A) | `0x…008D25c5` | [`0.0.9250245`](https://hashscan.io/testnet/token/0.0.9250245) |
| Claim NFT (HTS) | `0x…008D25c6` | [`0.0.9250246`](https://hashscan.io/testnet/token/0.0.9250246) |
| SaucerSwap pair (share/WHBAR) | [`0x7E1aa858…B7Fd`](https://hashscan.io/testnet/contract/0x7E1aa858ff27549A77Fa7D9E1C1299c02672B7Fd) | — |

The canonical, always-current set lives in [`deployments/testnet.json`](deployments/testnet.json).

## Security & testing

- **78 pure-logic tests** mirror the contract's exact integer math (NAV, queue netting, overflow
  guards); the deployed-bytecode HTS/HSS round-trips are proven live via `pnpm run smoke` and
  `pnpm run smoke:hss`.
- `ReentrancyGuard` + checks-effects-interactions on every value path; `settleRewards` gated by the
  claim's settler set and capped at the expected repayment; `Ownable2Step` + a timelock on
  finance/default; an operator allowlist; a dead-shares seed against first-depositor inflation; and
  `int64` overflow guards at the HTS boundary.
- The codebase went through a two-phase adversarial review (multi-agent audit + independent
  verification), with all findings fixed and re-deployed.

## License

[MIT](LICENSE) © 2026 Wafer

<div align="center">
<sub>Built for ETHGlobal New York 2026 · Hedera — Tokenization track</sub>
</div>
