# Wafer — One-pager (working draft, aligning — not locked)

> InfraFi liquidity for DePIN, on Hedera. Pooled investor capital finances curated deals;
> repayments grow NAV. Settlement: native HBAR (testnet) — production target USDC.
> Target track: Hedera Tokenization. FR version: [`ONE-PAGER.fr.md`](ONE-PAGER.fr.md).

## The idea

DePIN operators (GPU/compute, wireless, mapping, energy) must buy hardware today to earn
on-chain rewards over months. Wafer finances that gap and turns it into a **liquid,
NAV-appreciating fund share**. DePIN is the flagship category; the same rails finance any deal
with an advance, a repayment and a maturity.

## Two sides (Centrifuge / Maple model)

- **Investors** deposit HBAR into a pool (by category + risk class, e.g. `GPU-A`) and receive a
  fungible, NAV-appreciating **pool share**. Redeem at NAV any time. Exposure is **diversified
  across all the pool's deals** — a tokenized short-term credit fund. You don't pick a single
  deal; you buy the pool.
- **Companies** (DePIN operators first) **propose a deal**: company, description, advance,
  repayment, maturity, category. An **admin** reviews and assigns a **risk class** → the matching
  pool **finances** it (advances HBAR + mints a reward-claim NFT held by the vault).

So "deals" live on the **supply side** (what the pool finances), curated by the admin. Investors
fund the **pool**, not an individual deal. (Deal-specific backing = Goldfinch-style junior
tranches — a V2 option, see below.)

## Why DePIN is the wow

DePIN is the one RWA category whose cashflow is **natively on-chain**: real hardware earns
protocol rewards automatically to an on-chain address — no invoice, no bank, no fiat bridge. So
repayment needs **no trust in a human paying** and no off-chain settlement: the operator
**routes its on-chain reward stream to the vault** for the term, and **NAV ticks up live** as
rewards land. (Generic, non-DePIN deals repay by an on-chain send — same rails, weaker trust
story. DePIN is where the model is trust-minimized.)

## Lifecycle

1. A company proposes a deal (off-chain intake).
2. Admin reviews + assigns a class → routes it to the matching pool.
3. The pool **finances** it: advances HBAR to the company, mints the claim NFT (held by the vault).
4. **Repayment** flows in — DePIN reward routing; installments or lump → pool **NAV rises**.
5. On full repayment the **NFT burns** (claim Repaid). On default → **write-down** (NAV falls),
   loss shared across the pool.
6. Investors hold / redeem pool shares at NAV throughout; secondary market on SaucerSwap
   (share / WHBAR).

## Hedera stack

- **HTS fungible pool-share** token (KYC + freeze keys, low fractional fee) — the tokenized fund unit.
- **HTS reward-claim NFT** — the on-chain record of each financed deal, held by the vault.
- **`WaferVault`** smart contract (HSCS, via `@hiero-ledger/hiero-contracts`) — pools, financing,
  NAV, deposit/redeem, settlement, default. **Native HBAR** settlement.
- **SaucerSwap** — secondary market (share / WHBAR).
- Live on testnet: vault `0xc452D23791F9fC0c43B82E298b337B0A3525cd0A`, pool GPU-A, Sourcify-verified.

## Open / to refine (not locked)

- **Liquidity:** shares are elastic (mint on deposit / burn on redeem). Redemptions served from
  idle HBAR; when the pool is fully deployed, a redemption **queue/epoch** (Centrifuge / Maple style).
- **Deal-specific backing (V2):** Goldfinch-style **tranches** — back a single deal as junior /
  first-loss vs the diversified senior pool — if we want true "invest in this deal" exposure.
- **Settlement asset:** HBAR for the testnet MVP; **USDC** the production target (stable denomination).
- **Repayment trust:** DePIN = on-chain reward routing (trust-minimized); other categories =
  on-chain send (testnet) / SPV-escrow (production).
- **Proposals:** off-chain intake + on-chain deal record on admin approval (metadata off-chain).

## Demo

Deposit HBAR → pool shares at NAV. Admin finances a DePIN deal (advance + NFT). Reward HBAR
streams into the vault → **NAV ticks up live**. The NFT burns at settlement. Investor redeems at
NAV for the gain. Secondary swap on SaucerSwap as the alternative exit.
