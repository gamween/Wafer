# Wafer

> InfraFi liquidity for DePIN. Operators sell their future on-chain rewards for upfront USDC; investors hold a NAV-appreciating, KYC-gated pool share. Built entirely on Hedera with the SDK — **zero Solidity**.

Wafer is a permanent, NAV-appreciating tokenized fund on Hedera (HTS) that buys DePIN
operators' future on-chain rewards for upfront USDC. The name: a *wafer* is the thin slice of
silicon every GPU and chip is cut from — the physical substrate of the compute economy that
Wafer turns into liquid, on-chain yield. "InfraFi" is the category; Wafer is the product.

- **One-pager (judge-facing):** [`docs/ONE-PAGER.md`](docs/ONE-PAGER.md)
- **Full technical spec:** [`SPEC.md`](SPEC.md)
- **Sponsor / track strategy:** [`docs/TRACKS.md`](docs/TRACKS.md)

ETHGlobal New York 2026 · brand-new project · built on Hedera Testnet.

## What it does (60 seconds)

1. A DePIN operator (GPU/compute, wireless, mapping, energy) needs capital today; their
   rewards arrive on-chain over time. They sell a slice of those future rewards.
2. Wafer records the financed claim as an **HTS NFT** held by a pool vault, and advances
   USDC to the operator.
3. Investors deposit USDC and receive a fungible **HTS pool-share token** — a share of a
   permanent vault, standardized by network + risk (e.g. `GPU-A`, `WIFI-B`).
4. The operator routes its rewards (USDC) into the vault. NAV per share rises continuously.
5. Investors exit any time by **redeeming at NAV** (SaucerSwap secondary listing is roadmap).

Everything settles in on-chain USDC (testnet `0.0.429274`). No fiat bridge, no Solidity.

## Architecture in one diagram

```
                  ┌─────────────────────────────────────────────┐
   DePIN operator │  Wafer operator backend (TypeScript, SDK)  │  Investor
   ──────────────▶│                                             │◀──────────
   routes rewards │  • HTS: pool-share token (mint/burn, KYC)   │  deposits USDC
   (USDC) to vault│  • HTS: reward-claim NFTs (held by vault)   │  holds share
                  │  • HCS: NAV + lifecycle event log (topic)   │  redeems at NAV
                  │  • Scheduled Tx: reward sweeps (optional)   │
                  └───────────────┬─────────────────────────────┘
                                  │ all state on-ledger
                          ┌───────▼────────┐        ┌────────────────┐
                          │  Hedera HTS/HCS│◀──────▶│  Mirror Node   │──▶ frontend
                          │   (testnet)    │  reads │   REST API     │   recomputes NAV
                          └────────────────┘        └────────────────┘
```

The backend orchestrates; the Hashgraph is the source of truth. Every share minted, every
dollar of NAV, every reward swept is on-ledger and independently reconcilable via the Mirror
Node — see the trust model in [`SPEC.md`](SPEC.md#7-trust-model).

## Repo layout

```
src/
  config.ts            env + typed config
  hedera/
    client.ts          Hedera Client (operator)
    tokens.ts          create/mint/burn the pool-share token + claim NFT collection
    topic.ts           HCS NAV + event topic
    transfers.ts       atomic deposit / redeem / settlement TransferTransactions
    kyc.ts             associate + grant/revoke KYC
    mirror.ts          Mirror Node REST client (NAV history, balances, holders, NFTs)
  vault/
    types.ts           domain types (Pool, Claim, NavSnapshot, events)
    pool.ts            pool registry (GPU-A, WIFI-B, ENERGY-A)
    nav.ts             NAV engine (amortized-cost model)
    vault-service.ts   orchestration: deposit, redeem, financeClaim, settle, sweep
  agent/
    settlement-agent.ts  optional autonomous agent (Hedera Agent Kit) — AI track
  api/
    server.ts          Fastify API
scripts/
  bootstrap.ts         hour-0 setup: create token + NFT collection + topic, associate USDC
  demo.ts              scripted end-to-end demo (finance → deposit → reward → NAV up → redeem)
web/                   frontend (Next.js + Privy) — see web/README.md
```

## Quick start

```bash
# 1. install (Node 22, pnpm)
pnpm install

# 2. configure — copy and fill operator credentials from the Hedera portal
cp .env.example .env
#   get a testnet account:  https://portal.hedera.com/  (faucet: 100 test HBAR / 24h)
#   get test USDC:          https://faucet.circle.com/  (Hedera, ~20 USDC / 2h)

# 3. create on-chain resources (writes token/topic ids back to stdout — paste into .env)
pnpm bootstrap

# 4. run the scripted demo end-to-end
pnpm demo

# 5. (optional) run the API
pnpm api
```

## 36-hour build plan

| Window | Goal |
|---|---|
| 0–2h  | Accounts + USDC decision (`0.0.429274` vs mock), `pnpm bootstrap`: share token + claim NFT collection + HCS topic |
| 2–12h | Deposit (mint + atomic transfer + KYC gate) and redeem-at-NAV; NAV computed in backend, published to HCS |
| 12–24h| Claim NFT minting, settlement/reward-routing transfers, Mirror-Node-driven dashboard, one scheduled sweep |
| 24–36h| Privy embedded wallet on Hedera EVM, optional SaucerSwap listing (Tokenization submission only), polish, judging script |

Stretch (unlocks Hedera's $6k AI track): the autonomous settlement agent in `src/agent/`.

## License

MIT.
