# Wafer

> InfraFi liquidity for DePIN, on Hedera. Pooled investor capital finances DePIN operators'
> future on-chain rewards for upfront HBAR; investors hold a NAV-appreciating, KYC-gated pool
> share — a tokenized short-term credit fund.
> Hedera Testnet (chain 296) · target track: **Hedera Tokenization** · FR: [`ONE-PAGER.fr.md`](ONE-PAGER.fr.md).

## Problem

DePIN operators (GPU/compute, wireless, mapping, energy, storage) must buy hardware **today** to
earn protocol rewards over **months**. That timing gap is capital they don't have — and legacy
credit can't underwrite an on-chain reward stream.

## What Wafer is

A **financing layer, not an operator.** Wafer never runs nodes or takes positions in DePIN
networks. Operators who **already** earn on-chain rewards come to Wafer for cash now against those
future rewards; investors supply that cash through pools and earn the yield. Think Centrifuge /
Maple, specialized for DePIN reward streams.

## Two sides

- **Investors** fund a **pool** (category × risk class, e.g. `GPU-A`) and receive a fungible,
  NAV-appreciating, **KYC-gated pool share**. Exposure is **diversified across all the pool's
  deals** — you buy the pool, not a single deal. Redeem at NAV.
- **Operators** propose a **deal** (company, description, advance, repayment, maturity, category).
  An **admin** reviews and assigns a **risk class** (weighing both risk and offered APR) → the
  matching pool **finances** it: advances HBAR + mints a **reward-claim NFT** held by the vault.

## Why DePIN is the wow

DePIN is the one RWA category whose cashflow is **natively on-chain**: hardware earns protocol
rewards automatically to an on-chain address — no invoice, no bank, no fiat bridge. Repayment needs
**no trust in a human paying**: the operator **routes its reward stream to the vault** for the term
(payout-address redirection, device-NFT escrow, or an authorized keeper), and **NAV ticks up live**
as rewards land. Everything in Wafer is real on-chain logic; **only the operator's reward cashflow
is simulated** in the demo (a stand-in reward source) — the routing mechanism is real, we simply
can't wire a live DePIN network during a hackathon.

## Economics

Each deal carries its own advance / expected repayment / maturity → its **own APR**. The pool's NAV
is the **blended, realized return** of all its deals (minus defaults), accrued **amortized-cost** —
so per-deal APR differences become one diversified pool yield. The risk class is the admin's
**risk-and-return curation**, so each pool has a coherent profile.

## Lifecycle

1. Operator proposes a deal.
2. Admin reviews + assigns a class → routes it to the matching pool.
3. Pool **finances**: advances HBAR, mints the claim NFT — the **on-chain receipt** (economic state
   lives in the contract; display data off-chain via Mirror Node).
4. Rewards **stream in** → pool NAV rises toward expected repayment.
5. Full repayment → the **NFT burns**. Default → **write-down** (NAV falls), loss shared across the pool.
6. Investors hold / **redeem at NAV** throughout.

## Hedera stack

- **HTS fungible pool-share** token (KYC + freeze + pause keys held by the vault, no custom fee) — the tokenized fund unit.
- **HTS reward-claim NFT** — the on-chain receipt of each financed deal, held by the vault, burned at maturity.
- **`WaferVault`** smart contract (HSCS, via `@hiero-ledger/hiero-contracts`) — pools, financing,
  amortized-cost NAV, deposit/redeem, reward settlement, default. **Native HBAR**.
- **Mirror Node** — the front reads NAV/pools/deals/activity (deal terms emitted as events). Sourcify-verified.

## Roadmap

Real per-network reward-routing integrations (Helium, Render, io.net…) · secondary market on
**SaucerSwap** (share / WHBAR) for an instant exit · redemption **queue/epoch** when a pool is
fully deployed · stablecoin denomination option · more categories and finer risk classes.

## Demo

Fund `GPU-A` with HBAR → pool shares at NAV. Admin finances a DePIN deal (advance + NFT). Reward
HBAR streams into the vault → **NAV ticks up live**. The NFT burns at settlement. Investor redeems
at NAV for the gain.
