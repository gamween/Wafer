# Wafer — Code Audit (pre-presentation)

Date: 2026-06-14 · Network: Hedera Testnet (chain 296) · Commit baseline: `7ffa715`
Method: 8-dimension multi-agent audit (accounting · security · spec-matrix · mocks/scripts ·
frontend-wiring · UX-flow · live-on-chain · track-fit), each finding **adversarially
re-verified** against the source, plus a **live Mirror Node** check of the deployed state, plus a
first-hand read of `WaferVault.sol`, both mocks, and `smoke.ts`.

---

## 0. Headline verdict

**The front and the back are fundamentally sound and the demo flow is real.** Specifics:

- **Every live transaction passes.** The Mirror Node confirms all **21** of the vault's recent
  contract calls returned `SUCCESS` (0 failures), and the three headline txs (deploy, `createPool`,
  `enableSecondaryMarket`) all landed `status 0x1`. The share token, claim NFT, and the SaucerSwap
  pair exist and the pair genuinely **holds reserves** (2.0 wGPUA + WHBAR + LP). The deployed token
  keys all resolve to the vault.
- **The core accounting is provably correct.** All three SPEC §5.3 worked examples (single deal,
  2-deal blend, default) re-derive to the digit from the actual integer Solidity; invariants
  I2/I3/I4/I6/I7/I10 hold; the BigInt mirror in `vault-accounting.test.ts` matches the Solidity
  line-for-line (no arithmetic drift). `pnpm test`: **70 passing**. Compile: clean.
- **No blocker.** Nothing in the demo path bricks or loses funds. The one **High** is an edge-case
  overflow guard reachable only in an *already-impaired* pool with a *near-uint64-max* deposit — not
  the demo. Everything else is **Medium/Low polish, doc drift, or track-fit**.

So: this is a strong base to present. The work below is hardening + credibility + the Hedera
"scheduled transfers" upgrade — not firefighting.

---

## 1. Live on-chain verification (proof the tx pass)

| Artifact | Hedera id | Status |
|---|---|---|
| Vault contract | `0.0.9228634` | live, not deleted |
| Share token (wGPUA) | `0.0.9228636` | FUNGIBLE_COMMON, 8dp, treasury=vault, keys=vault |
| Claim NFT | `0.0.9228637` | NON_FUNGIBLE_UNIQUE, supply+wipe=vault |
| SaucerSwap pair | `0.0.9228672` (`0x22CD…426B1`) | live, holds 2.0 wGPUA + WHBAR + LP `0.0.9228673` |
| deploy / createPool / enableSecondary txs | — | all `SUCCESS` (0x1) |
| Vault recent calls | — | **21/21 SUCCESS, 0 failed** |
| Operator `0.0.9185964` | `0xf6fAc…BDbF` | live, ~464 HBAR |

One reality check it surfaced: the **share token has no `wipe` and no `pause` key on-chain**
(`wipe_key: null`, `pause_key: null`) — code and chain agree (only SUPPLY/KYC/FREEZE are set); it's
the **spec that overstates** the key set. See M1.

---

## 2. Findings (consolidated, deduped, post-verification severity)

Severities are the **adversarially-corrected** ones. Where N agents found the same thing, it's one
row.

### HIGH

**H1 — `deposit` mints a uint256-derived share amount but truncates to `int64` with no guard
(overflow/accounting divergence in an impaired pool).**
`WaferVault.sol:705-726`. The only guard is `require(msg.value <= type(uint64).max)`. But
`sharesMinted = assets * totalShares / netAssets` is unbounded: after a `markDefault` writes the
receivable down (NAV < 1, `netAssets << totalShares`), a single legal deposit (≤ uint64.max tinybar)
can compute `sharesMinted > type(int64).max`. `p.totalShares += sharesMinted` then credits the full
uint256 while `mintToken(int64(uint64(sharesMinted)))` / `transferToken(...)` mint the truncated (or
sign-wrapped **negative**) amount → internal accounting permanently diverges from HTS supply,
corrupting `navPerShare` for everyone. `redeem` *does* guard (`shares <= uint64.max`) — `deposit` is
asymmetric. Found independently by the accounting **and** security agents.
**Fix (1 line):** after computing `sharesMinted`, add
`require(sharesMinted <= uint256(uint64(type(int64).max)), "SHARES_OVERFLOW");`
and switch the universal HTS-amount ceiling from `uint64.max` to `int64.max` at `redeem:745`,
`enableSecondaryMarket:847`, and the `msg.value` guards (HTS amounts are `int64`).

### MEDIUM

**M1 — `pausePool` is a storage flag, not a real HTS pause; share token also lacks a `wipe` key.**
(SPEC-1 / SEC-3 / LIVE-1 / LIVE-2 / HED-2 — 5 agents + live-confirmed.) `_createShareToken:395-398`
sets only SUPPLY/KYC/FREEZE. `pausePool/unpausePool` flip `Pool.status` (gating
deposit/redeem/claimRedemption) but never call HTS `pauseToken`, so **shares stay tradeable on
SaucerSwap and peer-to-peer while a pool is "paused."** D10/§8/ONE-PAGER advertise pause as a "real
compliance lever" and list `wipe`/`fee_schedule`/`pause` keys that don't exist. KYC + per-account
`freeze` *are* real on-chain. **Fix:** either add the PAUSE (and WIPE) key and call
`pauseToken/unpauseToken`, **or** downgrade the SPEC/ONE-PAGER claims to "pool-status gate only." Pick
one; make code and docs agree.

**M2 — The "0.10% fee" ghost: dead constants, stale comments, and tests that assert a fee the token
doesn't have.** (SEC-2 / FE-4 / HED-3 / ACC-5.) Ground truth: `_createShareToken` calls
`createFungibleTokenWithCustomFees` with **empty** fee arrays (`:416-417`) → no fee, per D11. But
`FEE_NUMERATOR/DENOMINATOR` (`:74-75`) are dead, comments at `:121/:344/:735` describe a 0.10% fee,
`ONE-PAGER.md:59` advertises one, and **`vault-statemachine.test.ts:565` + `vault-accounting.test.ts:724-748`
assert live-fee behavior + a secondary-market step sequence (`grantKyc:router` →
`addLiquidityETHNewPool`) the contract does NOT implement.** The tests certify fiction. **Fix:** delete
the dead constants + fee comments; rewrite/delete the fee tests; fix the secondary-step assertion to
the real `createPair → grantKyc(pair) → addLiquidityETH` sequence. (Credibility: a judge who reads
the code will catch the mismatch.)

**M3 — `financeClaim` ignores the senior `queuedShares` earmark and can strand queued redeemers.**
`WaferVault.sol:543`. It checks raw `idle >= advance`, but `idle` may already owe HBAR to the senior
redemption queue (everywhere else, `_liquidAssets` treats only `idle - queuedShares` as free). Admin
can finance a deal that drains the queue's backing into an illiquid receivable; `claimRedemption`
(needs `idle >= owed`) then can't pay the senior redeemers until rewards settle. **Fix:**
`require((p.idleTinybar - p.queuedShares) >= d.advanceTinybar)`.

**M4 — A queued redemption can become structurally unpayable after a default; `netAssets` silently
clamps to 0.** `WaferVault.sol:953-956, 792-812`. If the receivable backing a queued claim is wiped
by `markDefault`, `_netAssets` clamps to 0 (no event) and the senior queued HBAR can never be paid
while juniors also go to 0. **Fix:** surface the condition (event/view) or pro-rata haircut the queue
on default.

**M5 — The Secondary (SaucerSwap exit) screen is fully built but never mounted — and `DEMO.md`
promises it.** (FE-1 / UX-1.) `Secondary.jsx` (live pair, reserves, in-app buy, deep link) is never
imported; `App.jsx` has no route, `Explore`'s sub-tabs are only pools/deals/activity, and `TopNav`
even carries a stale "Explore absorbs … secondary" comment for a tab that doesn't exist. DEMO.md
Option B **step 6** tells you to show it. **Fix (one import + render):** add a `secondary` sub-tab in
`Explore.jsx` rendering `<Secondary contracts account publicClient onStatus refreshKey />` (props
already available).

**M6 — The `HowItWorks` explainer is built but never rendered; the landing has no priming.** (UX-2 —
this is your "flow not intuitive" pain point.) The disconnected landing renders only `Hero` (dense
copy); the 3-step `HowItWorks.jsx` component is orphaned. **Fix:** render `<HowItWorks onEnter={goApp}/>`
under `Hero` in `App.jsx`.

**M7 — `smoke.ts` swallows the default-run and secondary-market failures and still exits 0.**
(MSR-1.) Both are SPEC §15 ship requirements; if either reverts live, the run prints a warning but
reports green. **Fix:** `process.exitCode = 1` (or a loud banner) when `defaultRan`/`secondaryOk` are
false.

**M8 — Timelock is inert by default (`timelockDelay = 0`).** (SPEC-2 / SEC-5.) D9 sells
`financeClaim`/`markDefault` as timelocked, but they execute immediately until `setTimelockDelay(>0)`
is called. **Fix:** set a non-zero default in the constructor or in `deploy.ts`, or document that 0 =
no timelock (fine for the demo, but say so).

### LOW / polish

- **L1 (ACC-6)** Tiny holders can't `redeem` when NAV<1 (`ZERO_ASSETS` floor) — secondary exit
  exists; document it.
- **L2 (UX-3)** KYC dead-ends with no guided path; the single-key demoer must switch to **Admin** and
  self-allowlist. Add an in-context "get allowlisted" hint / persona cue.
- **L3 (MSR-2)** Repeated `smoke` runs can drain `idle` (deposit skipped, fresh deal each run) →
  `INSUFFICIENT_IDLE`. Clean deploy+smoke is fine; top-up or skip-if-active-claim for reruns.
- **L4 (MSR-3)** Over-funding a schedule (`reward > expected`) would brick its drips
  (`CLAIM_NOT_ACTIVE`). Not triggered (smoke sizes `reward == expected`). Cap drip at remaining.
- **L5 (MSR-6)** Drip deadline is tight and uses `Date.now()` vs on-chain `block.timestamp`; the
  Repaid/burn step may not complete (NAV proof still holds). Read `claim.startTime`; widen deadline.
- **L6 (SEC-6)** `enableSecondaryMarket` ignores `addLiquidityETH` returns, leaves a router allowance
  + untracked treasury shares. Capture returns; reset allowance.
- **L7 (FE-2)** Deposit **MAX** sets the full HBAR balance → guaranteed gas-shortfall revert. Reserve
  ~1–2 HBAR headroom on the deposit tab.
- **L8 (`createPool` over-funding — own finding)** `createPool` forwards the full attached balance to
  both HTS creates; only `DEAD_SEED_TINYBAR` (0.00001 HBAR) is recorded as `idle`. The create-refund
  surplus (~most of the ~100 HBAR you attach) accrues to `address(this).balance` **untracked, with no
  owner `sweep`/`withdraw` function** — solvency-safe (extra cushion) but unrecoverable admin HBAR.
  Add an `ownerWithdrawSurplus()` (balance − Σ pool idle) for prod, and attach less in the demo.
- **L9 (SPEC-6)** Post-default recoveries can't route via `settleRewards` (it's `Active`-only),
  contradicting §9's "keeper routes proceeds back via settleRewards." Doc it or add a recovery entry.
- **L10 (UX-5)** NAV shown bare (`1.0000`) with no ">1.0 = profit" anchor; orphan
  components (`Sidebar`/`Dashboard`/`CardNav`); unsignposted operator/admin steps.

### INFO / doc-only

- **§5.1 vs §5.2:** §5.1's formulas use GROSS `idle+receivable`; §5.2 I10 (and the code) use NET
  `idle+receivable-queuedShares`. Code is right; §5.1 is stale.
- **§4.1 drift:** `queueHead` is listed but doesn't exist; `RedemptionRequest.shares` is actually
  `assetsTinybar`; `Pool.queuedShares` stores **tinybar**, not shares (misleading name). Rename →
  `queuedAssetsTinybar` to prevent a future edit mixing it with `totalShares`.
- **`docs/TRACKS.md`** describes a "pure-HTS / no-Solidity architecture" that contradicts the actual
  50 KB Solidity vault — scrub before a judge reads it.
- **D6** says class lives "on Pool + Claim"; the Claim carries neither (derivable via pool). Amend to
  "Pool + Deal."

---

## 3. Spec compliance (SPEC.md)

Near-complete. **Every §7 surface function and event is present with the correct access control and
signature; all §4.1 structs/enums/mappings exist; D1–D13 are reflected in code.** Genuine deviations,
all captured above:

- **§8 share-token keys:** 3 of 6 set (SUPPLY/KYC/FREEZE; no WIPE/FEE_SCHEDULE/PAUSE) → M1.
- **D10 pause / D9 timelock:** weaker than advertised → M1, M8.
- **§4.1 storage names / §5.1 formulas / D6:** doc drift (INFO).
- **§11 Secondary screen:** built, unmounted → M5.

`§15` IN-scope items all have a working code surface (vault, mocks, secondary market, freeze, operator
whitelist, timelock, native-HBAR settlement, live + verified). Pause and the Secondary screen are the
two "partial" items.

---

## 4. Hedera track fit + the "lock des virements" opportunity

Target: **Tokenization on Hedera** ($3k) + main Hedera ($15k).

**Real, code-backed:** vault-keyed HTS fungible pool-share, claim-NFT receipt, native-HBAR
settlement, amortized-cost NAV, SaucerSwap secondary — and **two genuine compliance levers**:
KYC-gated transfers and per-account freeze (both HTS-enforced, keyed to the vault). That's a solid
Tokenization story.

**Not met / overclaimed:** custom fee schedule (removed by design, D11 — but docs still imply one →
M2); pause as a *token-level* lever (M1); oracles + cross-chain (roadmap, honestly scoped OUT).

**The "lock des virements" = real Hedera Scheduled Transactions (HSS / HIP-1215).** Today **none** is
used: the finance/default timelock is a pure EVM `block.timestamp` gate, and the reward "drip" is a
Solidity array advanced by an **off-chain JS poll loop** (`smoke.ts:239`) — which is exactly the
keeper anti-pattern the Automation framing penalizes. The dependency **already vendors**
`HederaScheduleService.sol` / `IHRC1215.sol` (HSS `0x16b`), import-ready and unreferenced. Highest-EV
additions, in order:

1. **Schedule the advance payout** at `financeClaim` as a programmed/locked native transfer → a
   visceral "locked virement" you can show executing on HashScan.
2. **Self-scheduling `settleRewards`** via HIP-1215 (no off-chain keeper) → removes the JS poll loop
   and strengthens the "no keepers" automation narrative.
3. **Schedule `markDefault`** at timelock expiry.

(Track-attribution note: the standalone "Autonomous On-Chain Automation" track is Continuity-only per
`TRACKS.md`; the scheduled-transactions value lands on the **Tokenization / No-Solidity bonus** lists,
not a fresh track.)

---

## 5. Prioritized action list

**Credibility (do before judges read the code — ~1h, zero risk):** M2 (scrub the fee ghost +
stale tests), the §4.1/§5.1/TRACKS doc drift, and decide M1's framing (fix the key or fix the claim).

**Demo completeness (make "retrace from start to finish" airtight — ~half day):** M5 (mount
Secondary), M6 (render HowItWorks), M7 (smoke fails loudly), L2 (KYC guidance), L7 (deposit MAX
headroom), L10 (NAV anchor).

**Correctness hardening (~1–2h):** H1 (deposit overflow guard — trivial, do it), M3 (finance respects
the queue earmark), M8 (timelock default). M4/L-series as time allows.

**Track upside (the "lock des virements" feature — ~0.5–1.5 days):** HSS scheduled advance payout
(#1), then self-scheduling settle (#2). Highest judge-impact item on the board.
</content>
</invoke>
