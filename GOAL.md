# Wafer — Overnight Autonomous Build Goal

> For an autonomous **Opus 4.8 / ultracode** `/goal` run, working **solo, overnight**, inside
> this repo (`~/Development/hackathons/Wafer`). Build until every box in **§1 Done** is checked.
> You may and should use **workflows / subagents** (parallel implementation + adversarial
> verification). Token cost is not a constraint; correctness and a *working, testable* flow are.

## 0. Mission (one line)

Fully implement the **Wafer** backend (the decided no-Solidity Hedera vault) and a **wired,
theme-agnostic frontend skeleton**, deployed and running **live on Hedera Testnet**, so that in
the morning a human can (a) run the end-to-end flow and (b) just pick a design direction (DA)
and theme it — everything already built together and perfectly wired.

## 1. Done = (the goal condition — verify each, with evidence)

Stop only when ALL of these are true and demonstrated:

- [ ] `pnpm install` clean; `pnpm typecheck` passes with zero errors.
- [ ] Unit tests pass (`pnpm test`): NAV engine (amortized-cost math, deposit/redeem share math, default write-down) and vault state transitions, run against a **mock Hedera client** (no network needed).
- [ ] `pnpm bootstrap` runs **live on testnet**: creates the pool-share HTS token, the reward-claim NFT collection, the HCS topic; sets up the **settlement token** (real USDC `0.0.429274` if the operator holds it, else a freshly-minted **mock-USDC** — see §3); creates a funded, KYC'd **demo investor** account (HBAR for gas + a settlement-token balance to deposit); writes all public ids (incl. the settlement token id) to `.env` **and** to a committed `deployments/testnet.json`. Idempotent (re-running detects existing ids and does not duplicate).
- [ ] `pnpm demo` runs the full lifecycle **live on testnet** and prints HashScan links: finance a claim → investor deposits USDC → reward sweeps arrive → **NAV per share rises** → investor redeems at NAV. The HCS topic shows the ordered event log.
- [ ] The API (`pnpm api`) boots and every endpoint in SPEC §8 works against the live pool.
- [ ] Frontend builds (`pnpm --filter web build`) and runs (`pnpm --filter web dev`); every screen renders **wired to the live API + Mirror Node** with a neutral theme (no design): pools list with live NAV + TVL, deposit form, redeem form, HCS activity feed, claim/portfolio view. Uses a **local dev wallet** (the demo investor), NOT Privy.
- [ ] `main` is green and runnable from a clean clone + `.env`; `deployments/testnet.json` committed; a `demo-r0` git tag points at the runnable state.
- [ ] `README.md` has a **"Test the flow"** section (exact commands) and a **"Pick a DA"** section (where/how to theme) — see §7.
- [ ] A short `RUN-REPORT.md` at repo root: what was built, the live token/topic/account ids + HashScan links, what passed, and anything left open with a clear reason.

## 2. Context & sources (read first)

In-repo (authoritative): `SPEC.md` (full technical spec — follow it), `docs/TRACKS.md` (sponsor
strategy), `docs/ONE-PAGER.md`, `README.md`, `CONTRIBUTING.md` (git workflow — follow it).

Reference vault (read for product context + Hedera docs + track wording):
`/Users/fianso/Library/Mobile Documents/iCloud~md~obsidian/Documents/Fianso's Vault/02 - Areas/Web3/Programs/DVB/Hackathons/ETHGlobal nyc/`
— especially **`Context.md`** (all Hedera doc links + the Hedera track requirements) and
`DePIN Liquidity Protocol — Pitchs Devrel.md`. Do NOT modify vault files; they are read-only reference.

Key Hedera docs (from Context.md): HTS, HCS, Scheduled Transactions, Mirror Node REST, JS SDK,
code snippets. Use the real ones; verify SDK class signatures against the installed `@hashgraph/sdk`.

## 3. Environment & credentials

`.env` already holds a **real, funded testnet operator** (`OPERATOR_KEY`, raw-hex **ECDSA**) and
**real USDC** (`USDC_TOKEN_ID=0.0.429274`).

- Parse the operator key with `PrivateKey.fromStringECDSA()`. Make key parsing robust (fall back to ED25519/DER if ECDSA fails) in `src/hedera/client.ts`.
- **Resolve `OPERATOR_ID` if blank**: derive the EVM address (`PrivateKey.fromStringECDSA(key).publicKey.toEvmAddress()`), GET `${MIRROR_NODE_URL}/accounts/0x{evmAddress}`, use `account` from the response; write it back to `.env`. **Already resolved: `OPERATOR_ID=0.0.9221779`** (`scripts/resolve-operator.ts`). Fail loudly only if the account can't be reached or has no HBAR.
- **Settlement asset (USDC)**: the operator currently holds **~10 ℏ but NO USDC** (token `0.0.429274` not associated, balance 0). So at bootstrap: **if** the operator has real Circle USDC associated with a positive balance, use `0.0.429274`; **otherwise create a mock-USDC HTS token** (6 dp, operator = treasury, mint a working supply, symbol e.g. `mUSDC`) and use it as the settlement asset, writing its id to `USDC_TOKEN_ID`. Same code path either way — only the token id differs. State clearly in `RUN-REPORT.md` which was used. Do NOT use an interactive faucet. HBAR is limited (~10 ℏ): keep fees small, no large loops; if a step fails with `INSUFFICIENT_PAYER_BALANCE`, stop and record it.
- **NEVER** commit `.env` or print `OPERATOR_KEY` / `DEMO_INVESTOR_KEY` to logs, commits, or `RUN-REPORT.md`. Public token/topic/account **ids** are fine to commit (`deployments/testnet.json`).

## 4. Scope tonight

IN (build fully, wired together):
- **Backend — the full core vault** (SPEC §3–§8): HTS pool-share token (6 dp, infinite supply, supply/KYC/freeze/admin keys, low fractional fee, exempt treasury); reward-claim NFT collection (metadata pointer ≤100 B, mutable status tracked via HCS); USDC treasury; atomic `TransferTransaction` deposit / redeem / advance / reward-sweep; KYC associate+grant flow; amortized-cost NAV engine; HCS topic for NAV + lifecycle events; Mirror Node read layer; Fastify API. Plus `scripts/bootstrap.ts` and `scripts/demo.ts` working live, and unit tests with a mock client.
- **Frontend skeleton** — Next.js (App Router) + Tailwind + **shadcn/ui**, in `web/`. All screens wired to the API + Mirror Node, neutral/unstyled-but-structured theme via design tokens so a DA can be dropped in. Local dev wallet (demo investor), no Privy.

OUT (do NOT build tonight — other tracks set aside on purpose):
- The autonomous AI settlement agent (`src/agent/` stays a documented stub).
- Privy / Dynamic / ENS / Arc / SaucerSwap integrations. Leave `src/agent` and Privy wiring documented only. (SaucerSwap secondary market is roadmap; redeem-at-NAV is the exit.)
- Any Solidity / smart contract. The vault is TypeScript-SDK only.

## 5. Build plan (suggested — orchestrate with workflows)

1. **Foundation**: `pnpm install`; robust client + key/OPERATOR_ID resolution; confirm live connectivity (read operator balance via Mirror Node). Commit on `chore/foundation`.
2. **HTS + HCS primitives** (`feat/hts-hcs`): token/NFT/topic creation, mint/burn, KYC, transfers, mirror reads — each with unit tests against a mock client.
3. **Vault service + NAV** (`feat/vault-nav`): deposit, redeem, financeClaim, settleRewards, markDefault; NAV engine + tests.
4. **Bootstrap + live demo** (`feat/live-demo`): `bootstrap.ts` (idempotent, persists ids), demo investor provisioning, `demo.ts` live; capture HashScan links.
5. **API** (`feat/api`): wire all endpoints to the vault service; a dev-mode that signs as the demo investor so the front needs no external wallet.
6. **Frontend skeleton** (`feat/web-skeleton`): Next.js + Tailwind + shadcn; pages/components wired to the API + Mirror Node; neutral theme via tokens; a `lib/api.ts` typed client and a `lib/mirror.ts` for live NAV/TVL/activity.
7. **Harden + verify** (`chore/verify`): full typecheck, tests, a fresh live `bootstrap` + `demo`, front build; write `RUN-REPORT.md`; tag `demo-r0`.

Each phase: branch → conventional commits → push → open a PR → **self-review with a reviewer
subagent** (no human is awake) → squash-merge → keep `main` green. Use `--force-with-lease` only
on your own branches; never force-push `main`.

## 6. Quality bar / guardrails

- Follow `SPEC.md` exactly; if you deviate, note why in `RUN-REPORT.md`.
- Money is integer micro-units (6 dp) everywhere — no floats for value.
- Adversarially verify the NAV math and the atomic-transfer leg signs (a wrong sign drains the vault in the demo). Add tests that would catch it.
- Frontend must be **design-agnostic**: semantic structure + shadcn components + a single tokens file (colors/spacing/radius) so the morning DA is a re-theme, not a rewrite. No hardcoded brand visuals.
- Keep it runnable from a clean clone: document every env var; `pnpm install && pnpm bootstrap && pnpm demo && pnpm --filter web dev` must work with only `.env` filled.
- Don't touch anything outside this repo (except read-only reference to the vault folder). Don't open external services, don't deploy to mainnet, don't push to any repo other than `origin` (`aiden-fianso/Wafer`).

## 7. Morning handoff (write this into README)

- **Test the flow**: `cp .env`… (already set) → `pnpm install` → `pnpm bootstrap` (or reuse `deployments/testnet.json`) → `pnpm demo` (watch NAV rise on testnet) → `pnpm api` + `pnpm --filter web dev`, open the app, deposit/redeem as the demo investor, watch NAV + activity update live.
- **Pick a DA**: point to the single tokens file + the shadcn theme entry; list the screens already wired so the user only restyles. Note where Privy would later replace the dev wallet (one provider + the HTS-association bootstrap, already documented).

## 8. If blocked

If a Done item is genuinely impossible autonomously (e.g., `OPERATOR_ID` can't be resolved and
no account id is set, or the account is unfunded), do NOT fake it: implement everything else,
make the live-dependent parts pass against the **mock client**, and record the exact blocker +
the one human action needed in `RUN-REPORT.md`. Never invent transaction results or HashScan links.
