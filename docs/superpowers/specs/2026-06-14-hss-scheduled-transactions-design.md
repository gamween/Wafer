# Design — HIP-1215 "locked virements" (Hedera Schedule Service) in Wafer

Date: 2026-06-14 · Status: approved (inline) · Target: Hedera Tokenization bonus (scheduled transactions)

## Goal

Make money movements in Wafer **native scheduled/locked transfers** via Hedera Schedule Service
(HIP-1215, system contract `0x16b`, live on testnet) — no off-chain keeper. Two flows:

1. **Locked advance payout** — the operator's advance is locked in the vault at finance and
   auto-released after a window.
2. **Self-scheduling reward settle** — the reward drip schedules its own next interval on-chain,
   replacing the off-chain JS poll loop.

Both are **opt-in toggles**; the default path is exactly today's verified behavior, so the demo can
fall back if HIP-1215 misbehaves live.

## API (verified)

`HederaScheduleService.scheduleCall(address to, uint256 expirySecond, uint256 gasLimit, uint64 value,
bytes callData) returns (int64 rc, address scheduleAddress)`. The scheduling **contract is the payer**
and must hold HBAR; the network auto-executes the call at `expirySecond` with no keeper. Self-calls
(`to == address(this)`) are supported.

## Feature 1 — Locked advance (`WaferVault`)

State: `uint64 advanceLockSeconds` (owner-set; 0 = instant, today's default), `uint256
pendingAdvanceTinybar` (Σ scheduled-unreleased advances), `mapping(uint256=>uint64) advanceUnlockTime`,
`mapping(uint256=>bool) advanceReleased`.

`financeClaim` effects unchanged (`idle -= advance`, `receivable += advance` → NAV flat). The advance
HBAR stays in the vault. The CEI-last step branches:
- `advanceLockSeconds == 0` → pay the operator immediately (today).
- else → set `advanceUnlockTime[claimId]`, `pendingAdvanceTinybar += advance`, and
  `scheduleCall(this, now+lock, RELEASE_ADVANCE_GAS, 0, releaseAdvance.selector(claimId))`; emit
  `AdvanceScheduled`.

`releaseAdvance(claimId)` — permissionless, `nonReentrant`, gated by `now >= unlock && !released`
(so it can neither pay early nor twice, even if called manually); HSS auto-fires it at expiry. Pays
the operator from the vault balance, decrements `pendingAdvanceTinybar`, emits `AdvanceReleased`.

`ownerWithdrawSurplus` excludes `pendingAdvanceTinybar` from sweepable surplus.

Invariant note: NAV-flat at finance (I3) is unaffected — only the *physical* timing of the operator
payout changes; the accounting (`idle→receivable`) is identical.

## Feature 2 — Self-scheduling drip (`MockRewardSource`)

Inherit `HederaScheduleService`. Refactor the drip body into internal `_release(scheduleId)`. Add:
- `armSelfDrip(scheduleId)` (owner) — turns on self-scheduling and schedules the first `scheduledDrip`.
- `scheduledDrip(scheduleId)` — releases the due interval (if any) then `_scheduleNext`; tolerates
  not-yet-due (just reschedules); stops when `dripsDone == dripCount` or `defaulted`.
- `_scheduleNext(scheduleId)` — `scheduleCall(this, nextIntervalBoundary, DRIP_GAS, 0,
  scheduledDrip.selector(scheduleId))`.

The manual `drip()` stays as the fallback. Demo: `fund(...)` → `armSelfDrip(id)` → **wait** → NAV
ticks up with no keeper.

## Frontend

Add the new functions/events to `web/lib/abi.js`. `AdvanceScheduled` / `AdvanceReleased` /
`Scheduled` then surface automatically in the Mirror-Node Activity feed. (Optional: a "scheduled,
unlocks in Ns" badge — stretch.)

## Tests

Pure-logic mirror for `releaseAdvance` gating (unlock-time + once-only) and `_scheduleNext` interval
math. The live HSS round-trips are proven by an extended `pnpm smoke` (a scheduled-advance run and a
self-drip run), like the other 0x167/0x16b paths.

## Risk

HIP-1215 is new. Both paths are opt-in; default = proven behavior. The single end-of-work redeploy +
extended smoke validates the scheduled paths live; toggles off = demo the fallback. New surface:
~3 fns + state in the vault, 3 fns + inheritance in the mock, smoke additions, abi entries.

## Demo

`advanceLockSeconds = 10s`. financeClaim → a scheduled tx appears on HashScan → 10s later it
self-executes paying the operator. fund + armSelfDrip → NAV rises with no script loop. Pitch: a
literal locked virement + genuine no-keeper automation, on a capability most teams won't touch.
