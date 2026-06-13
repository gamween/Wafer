# Wafer

> InfraFi liquidity for DePIN. Operators sell their future on-chain rewards for upfront USDC;
> investors hold a NAV-appreciating, KYC-gated pool share. A **Solidity vault on Hedera (HSCS)**
> that creates and manages **HTS tokens**, with a **SaucerSwap** secondary market.

Wafer is a permanent, NAV-appreciating tokenized fund on Hedera that buys DePIN operators'
future on-chain rewards for upfront USDC. The name: a *wafer* is the thin slice of silicon every
GPU and chip is cut from — the substrate of the compute economy that Wafer turns into liquid,
on-chain yield. "InfraFi" is the category; Wafer is the product.

- **One-pager (source of truth, judge-facing):** [`docs/ONE-PAGER.md`](docs/ONE-PAGER.md)
- **Full technical spec:** [`SPEC.md`](SPEC.md)
- **Sponsor / track strategy:** [`docs/TRACKS.md`](docs/TRACKS.md)

ETHGlobal New York 2026 · Hedera Testnet (chain 296) · target track: **Hedera Tokenization**.

## How it works (60 seconds)

1. A DePIN operator (GPU/compute, wireless, mapping, energy) needs capital today; rewards arrive
   on-chain over time. They sell a slice of those future rewards.
2. The `WaferVault` contract records the financed claim as an **HTS NFT** it holds, and advances
   USDC to the operator.
3. Investors deposit USDC and receive a fungible **HTS pool-share** token — a share of a
   permanent vault, standardized by network + risk (e.g. `GPU-A`).
4. The operator routes its rewards (USDC) into the vault. **NAV per share rises** continuously.
5. Investors exit any time: **redeem at NAV** (burn shares → USDC), or **swap on SaucerSwap**.

The vault is a smart contract → all logic is on-chain and verifiable. The frontend talks to the
contract **directly** via a wallet — no backend, no HCS.

## Architecture

```
  operator ──finance/settle──▶  WaferVault.sol (Hedera EVM)  ◀──deposit/redeem── investor
                                via @hiero-ledger/hiero-contracts:
   front (Next.js + viem) ────▶  creates/holds HTS pool-share + reward-claim NFTs,
   reads contract views          real USDC settlement, NAV, deposit/redeem/settle
   + Mirror Node                        │                    │
                              ┌─────────▼──────┐    ┌─────────▼──────┐
                              │  Hedera HTS    │    │  SaucerSwap V1 │  share/USDC pool
                              └─────────┬──────┘    └────────────────┘
                                        │ reads
                              ┌─────────▼──────┐
                              │  Mirror Node   │──▶ frontend
                              └────────────────┘
```

## Repo layout

```
contracts/WaferVault.sol   the vault — HTS tokens via @hiero-ledger/hiero-contracts
hardhat.config.ts          Solidity 0.8.24, network testnet (chain 296, Hashio)
scripts/
  deploy.ts                deploy vault, wire real USDC, create GPU-A pool, persist addresses
  saucerswap.ts            create share/USDC pool + add liquidity + sample swap (viem)
  demo.ts                  full lifecycle live: finance → deposit → settle (NAV↑) → redeem
  resolve-operator.ts      derive OPERATOR_ID from the key (Mirror Node)
src/                       TS setup utils kept from foundation (config, SDK client, key
                           parsing, deployments persistence) — used by scripts for HTS ops
                           the EVM can't do (e.g. operator auto-association)
web/                       Next.js + Tailwind + shadcn — talks to the contract via viem
deployments/testnet.json   committed: vault + token + pool addresses (public ids)
docs/ONE-PAGER.md · docs/TRACKS.md · SPEC.md · GOAL.md · CONTRIBUTING.md
```

## Quick start

```bash
pnpm install
cp .env.example .env          # OPERATOR_ID/KEY already set — TOP UP HBAR first (see below)

pnpm hardhat compile
pnpm deploy                   # deploy vault + GPU-A pool (real USDC 0.0.429274) → deployments/testnet.json
pnpm hardhat verify --network testnet <VAULT_ADDR>   # Sourcify / HashScan

pnpm demo                     # full lifecycle on testnet — watch NAV per share rise, then redeem
pnpm saucerswap               # create the share/USDC pool + a sample swap (HBAR-permitting)

cd web && pnpm install && pnpm dev    # frontend → contract (deposit / redeem / NAV / activity)
```

**HBAR.** Creating HTS tokens from the contract costs ~50–60 HBAR each (`msg.value`, excess
refunded) and the SaucerSwap pool ~$50 in testnet HBAR. The operator `0.0.9185964` holds
**~1000 testnet HBAR — sufficient** for the MVP.

## Test the flow

After `pnpm deploy` + `pnpm demo`, open the app (`cd web && pnpm dev`): connect the dev wallet,
deposit USDC, watch your share balance + the live NAV, then redeem at NAV. The activity feed
reads the contract's events from the Mirror Node. SaucerSwap swap is available once `pnpm
saucerswap` has seeded the pool.

## License

MIT.
