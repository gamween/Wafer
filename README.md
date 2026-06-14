# Wafer

> InfraFi liquidity for DePIN. Operators sell their future on-chain rewards for upfront HBAR;
> investors hold a NAV-appreciating, KYC-gated pool share. A **Solidity vault on Hedera (HSCS)**
> that creates and manages **HTS tokens**, settled in **native HBAR**, with a **SaucerSwap**
> secondary market.

Wafer is a permanent, NAV-appreciating tokenized fund on Hedera that buys DePIN operators'
future on-chain rewards for upfront HBAR. The name: a *wafer* is the thin slice of silicon every
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
   HBAR to the operator.
3. Investors deposit HBAR and receive a fungible **HTS pool-share** token — a share of a
   permanent vault, standardized by network + risk (e.g. `GPU-A`).
4. The operator routes its rewards (HBAR) into the vault. **NAV per share rises** continuously.
5. Investors exit any time: **redeem at NAV** (burn shares → HBAR), or **swap on SaucerSwap**.

The vault is a smart contract → all logic is on-chain and verifiable. The frontend talks to the
contract **directly** via a wallet — no backend, no HCS.

## Architecture

```
  operator ──finance/settle──▶  WaferVault.sol (Hedera EVM)  ◀──deposit/redeem── investor
                                via @hiero-ledger/hiero-contracts:
   front (Next.js + viem) ────▶  creates/holds HTS pool-share + reward-claim NFTs,
   reads contract views          native HBAR settlement, NAV, deposit/redeem/settle
   + Mirror Node                        │                    │
                              ┌─────────▼──────┐    ┌─────────▼──────┐
                              │  Hedera HTS    │    │  SaucerSwap V1 │  share/WHBAR pool
                              └─────────┬──────┘    └────────────────┘
                                        │ reads
                              ┌─────────▼──────┐
                              │  Mirror Node   │──▶ frontend
                              └────────────────┘
```

## Repo layout

```
contracts/WaferVault.sol   the vault — HTS tokens via @hiero-ledger/hiero-contracts, HBAR-settled
hardhat.config.cts         Solidity 0.8.24 (optimizer + viaIR), network testnet (chain 296, Hashio)
tsconfig.hardhat.json      CommonJS tsconfig for Hardhat (the repo is ESM)
scripts/
  deploy.ts                deploy vault, create GPU-A pool (~100 HBAR), persist ids + verify hint
  smoke.ts                 full lifecycle LIVE: finance → deposit → settle (NAV↑) → redeem, with links
  resolve-operator.ts      derive OPERATOR_ID from the key (Mirror Node)
test/vault-accounting.test.ts   pure-logic NAV/amortized-cost mirror (incl. queue-NAV netting), `pnpm test`
test/vault-statemachine.test.ts pure-logic access/timelock/KYC/pause/secondary-ordering mirror
web/                       Vite + React + viem — HBAR-wired; mock mode until VITE_VAULT_ADDRESS is set
deployments/testnet.json   committed: vault + token + pool ids + HashScan/Sourcify links
docs/ONE-PAGER.md · docs/TRACKS.md · SPEC.md · CONTRIBUTING.md
```

## Quick start

```bash
pnpm install
cp .env.example .env          # OPERATOR_ID/KEY already set — testnet HBAR funds everything

pnpm test                     # pure-logic NAV/units tests (no network)
pnpm run compile              # hardhat compile (clean)
pnpm run deploy               # deploy vault + GPU-A pool → deployments/testnet.json + VAULT_ADDRESS in .env
pnpm run verify <VAULT_ADDR>  # Sourcify (HashScan reads the verified contract from there)

pnpm run smoke                # full lifecycle on testnet — watch NAV per share rise, then redeem

cd web && pnpm install && pnpm dev    # frontend (mock mode this increment)
```

Note: use `pnpm run deploy`, not `pnpm deploy` — the latter is shadowed by pnpm's built-in command.

**HBAR.** Settlement is **native HBAR** — no USDC, no token association/allowance for settlement,
no faucet bridge. `createPool` does two HTS creates and forwards the full balance to each (excess
refunded), so attach ~100 HBAR; SaucerSwap pool ~$50 in testnet HBAR. The operator `0.0.9185964`
holds **~1000 testnet HBAR — sufficient** for the MVP.

## Test the flow

`pnpm run smoke` runs the full lifecycle live and prints HashScan links for every tx: it finances a
claim (advances HBAR), associates the share token, deposits HBAR, settles rewards (NAV rises), then
redeems at NAV. The current `deployments/testnet.json` records the live vault, tokens, and pool.
`web/` is now HBAR-wired (deposit is native-HBAR `payable`, 8-dp tinybar accounting, ABI matched to
the deployed contract). Set `VITE_VAULT_ADDRESS` to the deployed vault and the app reads NAV/pools/
balances from the contract and the activity feed from the Mirror Node.

### Test coverage — what `pnpm test` does and does NOT prove

`pnpm test` is a **pure-logic mirror**, not on-chain bytecode coverage. Every money path in
`WaferVault.sol` calls the Hedera HTS system contract at `0x167` (mint/burn/transfer/grant-KYC/
freeze/wipe), which has no local Hardhat EVM implementation, and this install has no
`ethers`/`hardhat-ethers` reachable from the test process — so the contract cannot be deployed and
called locally. The tests therefore re-implement the contract's exact integer arithmetic and
permissioning in BigInt (annotated `// CONTRACT:` per source line) and assert it against every SPEC
§5.3 worked example and §5.2 invariant — including the queue-NAV netting fix. **If the Solidity math
drifts from the mirror, the mirror cannot catch it**; the deployed-bytecode paths (HTS round-trips,
fee-exemption, KYC gating, device escrow/return, claim-NFT burn, secondary-market create) are proven
**LIVE on testnet by `pnpm run smoke`** (RUN A repaid + RUN B default, reading on-chain `navPerShare`
with HashScan links). Treat a green `pnpm test` as "the arithmetic is correct" and a green
`pnpm run smoke` as "the deployed contract executes it correctly" — you need both.

## License

MIT.
