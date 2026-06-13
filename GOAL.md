# Wafer — Overnight Autonomous Build Goal (v2, Solidity vault)

> For an autonomous **Opus 4.8 / ultracode** `/goal` run, solo, overnight, inside this repo
> (`~/Development/hackathons/Wafer`). Build until every box in **§1 Done** is checked. Use
> workflows / subagents (parallel build + adversarial verification). Token cost is not a
> constraint; a **working, testable, on-testnet flow** is.
>
> This SUPERSEDES the previous (no-Solidity) goal. The single source of truth is the one-pager
> `Wafer — Pitchs Devrel.md` in the Obsidian vault, implemented by `SPEC.md` in this repo.

## 0. Mission

Re-architect Wafer to the **smart-contract** design: a Solidity `WaferVault` on Hedera EVM
(HSCS) that creates and manages HTS tokens, a **SaucerSwap** secondary market, and a **wired
Next.js + Tailwind + shadcn frontend that talks to the contract directly** (no API). Deployed
and demonstrated **live on Hedera Testnet**. First **clean** the discarded no-Solidity work.

## 1. Done = (verify each, with evidence in RUN-REPORT.md)

- [ ] **Clean done** (§3): no-Solidity TS vault, Fastify API, HCS topic, agent stub, and `feat/vault-nav` artifacts removed from the build; deps/scripts updated; `main` has no dead code.
- [ ] `WaferVault.sol` compiles (`pnpm hardhat compile`), Solidity 0.8.24, using `@hiero-ledger/hiero-contracts@0.1.2`. Unit tests pass for the pure logic (NAV math, share math, default write-down).
- [ ] **Deployed live on testnet** (`pnpm deploy`): vault deployed; mock-USDC HTS token created; one **GPU-A pool** created (share token + claim NFT); the vault associated/KYC'd for its own tokens. Contract **verified on HashScan** (Sourcify). All public addresses written to `deployments/testnet.json` (committed) and `.env`.
- [ ] `pnpm demo` runs the **full lifecycle live**, printing HashScan links: financeClaim → investor deposit (USDC→shares at NAV) → operator settleRewards (USDC in) → **navPerShare rises** → redeem at NAV. A funded, KYC'd **demo investor** is provisioned.
- [ ] `pnpm saucerswap` creates the **share/USDC SaucerSwap V1 pool** + a sample swap (best-effort — if HBAR-blocked, see §2; record the exact blocker, don't fake it).
- [ ] Frontend builds + runs (`cd web && pnpm dev`): Pools+NAV, Deposit, Redeem, Activity screens **wired to the contract (viem) + Mirror Node**, neutral theme, dev wallet. Deposit/redeem work end-to-end against the live vault (incl. associate + approve flow).
- [ ] `main` green and runnable from a clean clone + `.env` (+ funded operator); `demo-r1` tag; `RUN-REPORT.md` with addresses, HashScan links, what passed, blockers.

## 2. Prerequisite the human must do BEFORE launching (and you must check)

The operator `0.0.9221779` (EVM `0xdae8992a9b5fe850be63781d1c2e65a3e496f728`, ECDSA key in
`.env`) needs **lots of testnet HBAR**: ~60 HBAR per HTS create + ~$50-in-HBAR for the SaucerSwap
pool. It currently has ~10 HBAR. **Top up at <https://portal.hedera.com/>.** At run start, check
the balance via Mirror Node; if it can't cover token creates, **stop and record it** — build +
compile + unit-test everything, deploy what HBAR allows, and clearly flag the funding blocker.
Never fake transactions or HashScan links. The SaucerSwap pool is the most likely HBAR casualty;
**redeem-at-NAV is the guaranteed exit and must work live** even if SaucerSwap can't be funded.

## 3. CLEAN first (the previous no-Solidity run built dead code)

REMOVE (no longer part of the architecture):
- `src/api/` (Fastify), `src/hedera/topic.ts` (HCS), `src/agent/`, `src/vault/` (TS vault,
  nav.ts, pool.ts, types.ts), `src/hedera/tokens.ts` / `kyc.ts` / `mirror.ts` / `transfers.ts`
  and any `mock-ledger.ts` / `ledger-port.ts` / `ledger.ts` / `transfer-legs.ts` / `*.test.ts`
  from the no-Solidity vault (they live on the abandoned `feat/vault-nav` branch — do not merge
  it). Drop `fastify`, `@fastify/cors` from deps and the `api` script.
KEEP / REUSE:
- `src/config.ts` (env), `src/hedera/client.ts` + `keys.ts` (SDK client + ECDSA key parsing —
  needed for setup ops the EVM can't do, e.g. operator auto-association), `src/deployments.ts`
  (persist addresses), `scripts/resolve-operator.ts`, and all meta (README, SPEC, docs,
  CONTRIBUTING, .env, .gitignore).
ADD:
- `contracts/WaferVault.sol`, `hardhat.config.ts`, Hardhat + `@hiero-ledger/hiero-contracts@0.1.2`
  + viem; `scripts/deploy.ts`, `scripts/saucerswap.ts`, `scripts/demo.ts`; `web/` (Next.js).
ALIGN DOCS (so no repo doc contradicts the source of truth):
- `docs/TRACKS.md` → Hedera **Tokenization** only, smart-contract path, SaucerSwap in MVP; drop
  the "No Solidity" track and the Privy/Arc/ENS sponsors (Hedera only now).
- `docs/ONE-PAGER.md` → match the source-of-truth one-pager (smart contract + SaucerSwap); drop
  any HCS / Scheduled Transactions / API mentions.

## 4. Build the contract (SPEC §3–§4 — follow it)

- Inherit `HederaTokenService, KeyHelper, ExpiryHelper, FeeHelper`. Vault = treasury + SUPPLY +
  KYC + FREEZE key (`KeyValueType.CONTRACT_ID`). Functions: `setUsdc`, `createPool` (**payable**),
  `financeClaim`, `deposit`, `redeem`, `settleRewards`, `markDefault`, `navPerShare` view; events
  `Deposit/Redeem/ClaimFinanced/RewardRouted/Default`; `poolCount`/`pools(i)`/`shareBalanceOf` views.
- Pool-share: fungible, **6 dp**, INFINITE supply, 0.10% fractional fee (collector = vault, all
  collectors exempt). Claim NFT collection held by the vault. Mock-USDC: fungible 6 dp the vault
  creates (real USDC `0.0.429274` is a config swap).
- **Check `responseCode == 22` and revert** on every HTS call (or use `SafeHTS`). Token-create
  funcs are `payable`; deploy script attaches ~60 HBAR + `gasLimit` 10M. Money = integer 6-dp
  micro-units. NAV = `totalShares==0 ? 1e6 : totalAssets*1e6/totalShares`.
- **deposit** pulls USDC via `transferFrom` (investor must `approve` first) and grants the
  investor KYC; **association + KYC ordering** is the #1 footgun (associate → grantKyc → transfer).

## 5. SaucerSwap (SPEC §5)

V1 RouterV3 `0.0.19264` (EVM `0x0000000000000000000000000000000000004b40`), Factory `0.0.9959`.
`addLiquidityNewPool` is **payable** — fee = `factory.pairCreateFee()` (tinycent) → tinybar via
Mirror `/network/exchangerate` → `msg.value`. Prereqs: associate both tokens, +1 auto-assoc for
the LP token, `approve` RouterV3 (HIP-376 facade). Then a sample `swapExactTokensForTokens`.

## 6. Frontend (SPEC §6)

Next.js + Tailwind + shadcn. viem `hederaTestnet` (chain 296; `nativeCurrency.decimals=18` —
keep separate from 6-dp USDC). Dev wallet from `NEXT_PUBLIC_DEV_PRIVATE_KEY`. `lib/wafer.ts`
(clients + typed contract calls + `ensureAssociated` via IHRC719), `lib/mirror.ts`, `lib/abi.ts`,
`lib/format.ts`. Deposit flow: `ensureAssociated(usdc)` → `approve(vault)` →
`ensureAssociated(share)` → `deposit`. Hollow-account guard (`devAccountReady()`). Neutral theme
via one tokens file so a DA drops in without touching logic. Screens: Pools+NAV, Deposit, Redeem,
Activity (decode contract logs from Mirror Node).

## 7. Workflow & guardrails

- Follow `CONTRIBUTING.md`: short-lived branches, Conventional Commits, PR + **self-review by a
  reviewer subagent** (no human awake) + squash-merge; keep `main` green. Never force-push `main`.
- Solidity only for the vault; **no** HCS, **no** API, **no** Privy/Arc/ENS, **no** AI agent.
- **Never** commit `.env` or print `OPERATOR_KEY` / `NEXT_PUBLIC_DEV_PRIVATE_KEY`. Public
  addresses → `deployments/testnet.json` (committed).
- Don't touch anything outside this repo (vault folder is read-only reference: `Context.md`,
  `Wafer — Pitchs Devrel.md`). Don't deploy to mainnet. Push only to `origin` (`aiden-fianso/Wafer`).
- Pin `gas` on HTS-touching calls; verify the contract on HashScan; keep HBAR spend lean.

## 8. Morning handoff (write into README + RUN-REPORT)

- **Test the flow**: `pnpm install` → `pnpm deploy` (or reuse `deployments/testnet.json`) →
  `pnpm demo` (NAV rises live) → `cd web && pnpm dev`, deposit/redeem in the UI, watch NAV +
  activity. SaucerSwap swap if the pool was seeded.
- **Pick a DA**: point to the single tokens file + the wired screens — restyle only.
- `RUN-REPORT.md`: vault address + HashScan link, token/pool ids, demo tx links, what passed,
  and any blocker (esp. HBAR / SaucerSwap) with the exact one human action needed.

## 9. If blocked

If HBAR is insufficient or a live step is impossible autonomously: implement + compile +
unit-test everything, deploy as far as HBAR allows, make the rest pass against Hardhat
local/unit where feasible, and record the exact blocker + the one human action in
`RUN-REPORT.md`. Never invent transaction results or HashScan links.
