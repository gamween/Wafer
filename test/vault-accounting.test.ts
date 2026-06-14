import { expect } from "chai";

/**
 * WaferVault — amortized-cost NAV accounting (pure-logic unit tests).
 *
 * WHY PURE-LOGIC: WaferVault.sol talks to the Hedera HTS system contract at 0x167 on EVERY
 * money-moving path (createPool / deposit / redeem / financeClaim / settleRewards / markDefault all
 * mint/burn/transfer HTS tokens). That precompile does NOT exist on a local Hardhat EVM, and this
 * repo's Hardhat install has no `ethers`/`hardhat-ethers` plugin reachable from the test process, so
 * the contract cannot be deployed-and-called locally. The HTS-touching end-to-end paths are proven
 * LIVE on testnet by `pnpm run smoke` (RUN A repaid + RUN B default, reading on-chain navPerShare).
 *
 * What these tests pin instead is the part that the smoke test CANNOT exhaustively sweep and that is
 * the actual ship-blocker: the integer arithmetic. We mirror the EXACT contract math here in BigInt
 * (truncating division, same field layout: idle/receivable split, carry-at-advance, amortized
 * target, carry-delta receivable lift) and assert it against the SPEC §5.3 worked examples to the
 * digit and against every invariant in SPEC §5.2. The contract is the source of truth — if the math
 * changes there, it must change here. The mirror functions below are copied line-for-line from
 * WaferVault.sol (see the // CONTRACT: comments mapping each to its source).
 *
 * UNITS (SPEC §3, verified live): inside the EVM everything is TINYBAR (1 HBAR = 1e8). msg.value,
 * address(this).balance, call{value:} are all tinybar; ONE = 1e8; share decimals = 8. The JSON-RPC
 * boundary is weibar (relay divides tx value by 1e10 -> tinybar); the contract NEVER hand-scales.
 */

// --- constants (CONTRACT: WaferVault.ONE / DEAD_SHARES / DEAD_SEED_TINYBAR) -----
const ONE = 100_000_000n; // 1e8 — 1.0 in tinybar / share micro-units (8 dp)
const HBAR = 100_000_000n; // 1 HBAR in tinybar
const WEIBAR = 1_000_000_000_000_000_000n; // 1 HBAR in weibar (RPC boundary only)
const WEIBAR_PER_TINYBAR = 10_000_000_000n; // 1e10 — relay's RPC-boundary mapping
const UINT64_MAX = 2n ** 64n - 1n;
const MAX_HTS_AMOUNT = 2n ** 63n - 1n; // int64 max — the HTS-amount ceiling (CONTRACT: MAX_HTS_AMOUNT)
const DEAD_SHARES = 1000n;
const DEAD_SEED_TINYBAR = 1000n;

// =============================================================================
//                    BigInt mirror of the WaferVault state machine
// =============================================================================

type ClaimStatus = "Active" | "Repaid" | "Defaulted";

interface Claim {
  advance: bigint;
  expected: bigint;
  carry: bigint;
  settled: bigint;
  startTime: bigint;
  term: bigint;
  status: ClaimStatus;
}

interface Pool {
  idle: bigint; // CONTRACT: Pool.idleTinybar
  receivable: bigint; // CONTRACT: Pool.receivableTinybar
  totalShares: bigint; // CONTRACT: Pool.totalShares (incl. dead shares)
  queuedShares: bigint; // CONTRACT: Pool.queuedShares (held in tinybar of owed assets)
  minBufferBps: bigint; // CONTRACT: Pool.minBufferBps
}

interface RedemptionRequest {
  investor: string;
  poolId: number;
  assets: bigint;
  filled: boolean;
}

/** CONTRACT: createPool — seed DEAD_SHARES backed by DEAD_SEED_TINYBAR -> genesis NAV == ONE. */
function createPool(): Pool {
  return {
    idle: DEAD_SEED_TINYBAR,
    receivable: 0n,
    totalShares: DEAD_SHARES,
    queuedShares: 0n,
    minBufferBps: 0n,
  };
}

function totalAssets(p: Pool): bigint {
  return p.idle + p.receivable; // CONTRACT: totalAssets() — GROSS, DERIVED (I2)
}

/** CONTRACT: _netAssets() — gross (idle+recv) minus the senior queued-redemption liability,
 *  clamped at 0. This is the asset base backing LIVE shares; NAV/_convertTo* divide over it so a
 *  partially-filled redeemer's queued backing never inflates remaining holders. */
function netAssets(p: Pool): bigint {
  const gross = p.idle + p.receivable;
  return gross > p.queuedShares ? gross - p.queuedShares : 0n;
}

/** CONTRACT: navPerShare() — pre-seed (no shares) = ONE; post-seed = netAssets*ONE/totalShares. */
function navPerShare(p: Pool): bigint {
  if (p.totalShares === 0n) return ONE;
  return (netAssets(p) * ONE) / p.totalShares;
}

/** CONTRACT: _convertToShares() — assets * totalShares / netAssets (1:1 pre-seed). */
function convertToShares(p: Pool, assets: bigint): bigint {
  const na = netAssets(p);
  if (p.totalShares === 0n || na === 0n) return assets;
  return (assets * p.totalShares) / na;
}

/** CONTRACT: _convertToAssets() — shares * netAssets / totalShares. */
function convertToAssets(p: Pool, shares: bigint): bigint {
  if (p.totalShares === 0n) return 0n;
  return (shares * netAssets(p)) / p.totalShares;
}

/** CONTRACT: _liquidAssets() — (idle - queued) - reserve, reserve = minBufferBps*netAssets/10000. */
function liquidAssets(p: Pool): bigint {
  const freeIdle = p.idle > p.queuedShares ? p.idle - p.queuedShares : 0n;
  const reserve = (p.minBufferBps * netAssets(p)) / 10000n;
  return freeIdle > reserve ? freeIdle - reserve : 0n;
}

/** CONTRACT: deposit() — require msg.value <= uint64 max, guard derived shares <= int64 max
 *  (SHARES_OVERFLOW), mint at NAV, idle += assets. */
function deposit(p: Pool, assets: bigint): { sharesMinted: bigint } {
  if (assets <= 0n) throw new Error("ZERO_DEPOSIT");
  if (assets > UINT64_MAX) throw new Error("VALUE_TOO_LARGE");
  const sharesMinted = convertToShares(p, assets);
  if (sharesMinted <= 0n) throw new Error("ZERO_SHARES");
  // Derived share amount is NOT bounded by the msg.value guard; once NAV < 1 it can exceed int64
  // and the HTS cast would wrap/truncate, diverging accounting from supply (H1 / ACC-1 / SEC-1).
  if (sharesMinted > MAX_HTS_AMOUNT) throw new Error("SHARES_OVERFLOW");
  p.idle += assets;
  p.totalShares += sharesMinted;
  return { sharesMinted };
}

/** CONTRACT: financeClaim() effects — only deploy idle FREE of the senior queue (idle - queuedShares);
 *  idle -= advance; receivable += advance; carry := advance. */
function financeClaim(p: Pool, advance: bigint, expected: bigint, term: bigint, now: bigint): Claim {
  if (expected < advance) throw new Error("EXPECTED_LT_ADVANCE");
  const freeIdle = p.idle > p.queuedShares ? p.idle - p.queuedShares : 0n;
  if (freeIdle < advance) throw new Error("INSUFFICIENT_FREE_IDLE");
  p.idle -= advance;
  p.receivable += advance; // NAV FLAT (I3): assets unchanged, just idle -> receivable
  return {
    advance,
    expected,
    carry: advance, // carry-at-advance
    settled: 0n,
    startTime: now,
    term,
    status: "Active",
  };
}

/** CONTRACT: settleRewards() — the locked amortized-cost accrual (SPEC §5.1). */
function settleRewards(p: Pool, c: Claim, pay: bigint, now: bigint): { newCarry: bigint } {
  if (pay <= 0n) throw new Error("ZERO_REWARD");
  if (pay > UINT64_MAX) throw new Error("VALUE_TOO_LARGE");
  if (c.status !== "Active") throw new Error("CLAIM_NOT_ACTIVE");

  // cash arrives -> idle rises; settled accumulates.
  p.idle += pay;
  c.settled += pay;

  // target = advance + (expected - advance) * min(elapsed, term) / term  (clamped at term, I6)
  const elapsed = now - c.startTime;
  const capped = elapsed < c.term ? elapsed : c.term;
  const target = c.advance + ((c.expected - c.advance) * capped) / c.term;

  // newCarry = max(0, target - settled). receivable lifts only by the spread (carry delta).
  const newCarry = target > c.settled ? target - c.settled : 0n;
  // p.receivable += newCarry - c.carry  (under/overflow-safe, like the contract)
  if (newCarry >= c.carry) p.receivable += newCarry - c.carry;
  else p.receivable -= c.carry - newCarry;
  c.carry = newCarry;

  // full repayment: drop residual carry, mark Repaid (burn NFT + return device are HTS, live-only).
  if (c.settled >= c.expected) {
    if (c.carry > 0n) {
      p.receivable -= c.carry;
      c.carry = 0n;
    }
    c.status = "Repaid";
  }
  return { newCarry: c.carry };
}

/** CONTRACT: markDefault() — write down CARRY (not advance); receivable -= loss. */
function markDefault(p: Pool, c: Claim): { loss: bigint } {
  if (c.status !== "Active") throw new Error("CLAIM_NOT_ACTIVE");
  const loss = c.carry;
  p.receivable -= loss;
  c.carry = 0n;
  c.status = "Defaulted";
  return { loss };
}

/** CONTRACT: redeem() — instant fill <= liquidAssets, enqueue remainder; burn ALL shares. */
function redeem(
  p: Pool,
  queue: RedemptionRequest[],
  investor: string,
  poolId: number,
  shares: bigint,
): { filled: bigint; queued: bigint } {
  if (shares <= 0n) throw new Error("ZERO_SHARES");
  const investorShares = p.totalShares - DEAD_SHARES;
  if (shares > investorShares) throw new Error("OVER_REDEEM");

  const assets = convertToAssets(p, shares);
  if (assets <= 0n) throw new Error("ZERO_ASSETS");

  const liquid = liquidAssets(p);
  const filled = assets > liquid ? liquid : assets;
  const queued = assets - filled;

  p.totalShares -= shares; // ALL shares burned now
  p.idle -= filled;

  if (queued > 0n) {
    queue.push({ investor, poolId, assets: queued, filled: false });
    p.queuedShares += queued;
  }
  return { filled, queued };
}

/** CONTRACT: claimRedemption() — pay a queued request once idle covers it. */
function claimRedemption(p: Pool, queue: RedemptionRequest[], requestId: number): bigint {
  const req = queue[requestId];
  if (!req) throw new Error("NO_REQUEST");
  if (req.filled) throw new Error("ALREADY_FILLED");
  const owed = req.assets;
  if (p.idle < owed) throw new Error("NO_LIQUID");
  req.filled = true;
  p.idle -= owed;
  p.queuedShares -= owed;
  return owed;
}

// RPC boundary (relay/front-owned, NOT inside the contract).
const relayWeibarToTinybar = (w: bigint) => w / WEIBAR_PER_TINYBAR;

// receivable == Σ Active claims' carry (I4) — used to assert invariants across a scenario.
function sumActiveCarry(claims: Claim[]): bigint {
  return claims.filter((c) => c.status === "Active").reduce((a, c) => a + c.carry, 0n);
}

// =============================================================================
//                                   TESTS
// =============================================================================

describe("WaferVault — units & RPC boundary (relay-owned, SPEC §3)", () => {
  it("constants are the documented powers of ten", () => {
    expect(ONE).to.equal(100_000_000n);
    expect(WEIBAR_PER_TINYBAR).to.equal(10_000_000_000n);
    expect(UINT64_MAX).to.equal(18_446_744_073_709_551_615n);
  });
  it("relay maps 1 HBAR (weibar) to 1e8 tinybar; sub-tinybar dust truncates (never inflates)", () => {
    expect(relayWeibarToTinybar(WEIBAR)).to.equal(HBAR);
    expect(relayWeibarToTinybar(WEIBAR_PER_TINYBAR - 1n)).to.equal(0n);
    expect(relayWeibarToTinybar(WEIBAR + 9_999_999_999n)).to.equal(HBAR);
  });
});

describe("WaferVault — genesis & pool seeding (anti first-depositor inflation)", () => {
  it("pre-seed (totalShares==0) navPerShare is exactly ONE (I8)", () => {
    const empty: Pool = { idle: 0n, receivable: 0n, totalShares: 0n, queuedShares: 0n, minBufferBps: 0n };
    expect(navPerShare(empty)).to.equal(ONE);
  });

  it("createPool seeds DEAD_SHARES backed 1:1 -> genesis NAV is exactly ONE", () => {
    const p = createPool();
    expect(p.totalShares).to.equal(DEAD_SHARES);
    expect(p.idle).to.equal(DEAD_SEED_TINYBAR);
    expect(navPerShare(p)).to.equal(ONE);
  });

  it("the 1-wei (1-tinybar) donation/inflation attack rounds correctly — attacker cannot steal", () => {
    // Classic ERC-4626 first-depositor attack: attacker deposits 1, donates a big sum to inflate the
    // share price, then a victim's deposit rounds to 0 shares and the attacker redeems everything.
    // The seeded dead position (1000 shares <-> 1000 tinybar that the attacker does NOT own) defeats it.
    const p = createPool();

    // Attacker deposits the smallest unit (1 tinybar) -> mints 1 share (NAV is ONE here).
    const atkShares = deposit(p, 1n).sharesMinted;
    expect(atkShares).to.equal(1n); // 1 * 1000 / 1000 = 1
    expect(p.totalShares).to.equal(DEAD_SHARES + 1n);

    // Attacker "donates" 100 HBAR straight into idle (simulating a direct transfer to inflate price).
    p.idle += 100n * HBAR;

    // Victim deposits 1 HBAR. WITHOUT the dead position the victim could round to 0 shares; WITH it
    // the dead shares dilute the donation so the victim still mints a sane, non-zero amount.
    const victimShares = deposit(p, 1n * HBAR).sharesMinted;
    expect(victimShares > 0n).to.equal(true);

    // The attacker's stake is now a vanishing fraction of supply (the donation overwhelmingly backs
    // the dead shares the attacker cannot touch), so the attack does not profit the attacker.
    const attackerAssets = convertToAssets(p, atkShares);
    expect(attackerAssets < 100n * HBAR).to.equal(true); // attacker recovers far less than donated
  });

  it("dead shares are never redeemable (OVER_REDEEM caps redemptions at investorShares)", () => {
    const p = createPool();
    deposit(p, 10n * HBAR); // investor now owns (10*ONE) shares; pool holds those + DEAD_SHARES
    const investorShares = p.totalShares - DEAD_SHARES;
    expect(() => redeem(p, [], "alice", 0, investorShares + 1n)).to.throw("OVER_REDEEM");
    // exactly investorShares is fine
    expect(() => redeem(p, [], "alice", 0, investorShares)).to.not.throw();
  });
});

describe("WaferVault — deposit / redeem round-trip at NAV", () => {
  it("first real deposit at genesis NAV mints ~1 share micro-unit per tinybar", () => {
    const p = createPool();
    const { sharesMinted } = deposit(p, 10n * HBAR);
    // 10*ONE assets * 1000 shares / 1000 assets = 10*ONE shares
    expect(sharesMinted).to.equal(10n * ONE);
    expect(navPerShare(p)).to.equal(ONE);
  });

  it("second depositor at NAV > 1 receives fewer shares than HBAR", () => {
    const p = createPool();
    deposit(p, 100n * HBAR);
    // simulate realized yield lifting NAV to ~2.0 by adding spread to receivable
    p.receivable += 100n * HBAR;
    expect(navPerShare(p)).to.be.closeToBig(2n * ONE, 1000n);
    const { sharesMinted } = deposit(p, 20n * HBAR);
    // 20 HBAR / ~2.0 ≈ 10*ONE shares
    expect(sharesMinted).to.be.closeToBig(10n * ONE, 1000n);
  });

  it("redeem returns proportional HBAR at NAV; NAV unchanged by redeem", () => {
    const p = createPool();
    deposit(p, 100n * HBAR);
    p.receivable += 50n * HBAR; // NAV ~1.5
    const navBefore = navPerShare(p);
    redeem(p, [], "alice", 0, 10n * ONE); // fully liquid (idle has the cash)
    expect(navPerShare(p)).to.be.closeToBig(navBefore, 100n);
  });

  it("deposit guards msg.value at uint64 max AND the derived mint at int64 max (SPEC §3 / D13 + H1)", () => {
    expect(() => deposit(createPool(), UINT64_MAX + 1n)).to.throw("VALUE_TOO_LARGE");
    // At genesis NAV 1.0 sharesMinted == assets, so the binding ceiling is the HTS int64 mint amount:
    // a deposit in (int64.max, uint64.max] clears the msg.value guard but is rejected by SHARES_OVERFLOW
    // (the old behavior truncated the mint at the int64 cast — the H1 bug this guard closes).
    expect(() => deposit(createPool(), UINT64_MAX)).to.throw("SHARES_OVERFLOW");
    expect(() => deposit(createPool(), MAX_HTS_AMOUNT)).to.not.throw();
  });
});

describe("WaferVault — finance keeps NAV FLAT (invariant I3)", () => {
  it("financeClaim moves idle->receivable, leaving totalAssets and NAV unchanged", () => {
    const p = createPool();
    deposit(p, 100n * HBAR); // idle ≈ 100 HBAR + seed, recv 0, NAV 1.0
    const navBefore = navPerShare(p);
    const taBefore = totalAssets(p);

    const c = financeClaim(p, 90n * HBAR, 100n * HBAR, 90n, 0n);

    expect(totalAssets(p)).to.equal(taBefore); // I3: assets unchanged
    expect(navPerShare(p)).to.equal(navBefore); // NAV flat
    expect(p.receivable).to.equal(90n * HBAR); // I4: receivable == Σ active carry
    expect(c.carry).to.equal(90n * HBAR); // carry-at-advance
    // idle dropped by exactly the advance (it went out to the operator)
    expect(p.idle).to.equal(DEAD_SEED_TINYBAR + 100n * HBAR - 90n * HBAR);
  });

  it("rejects financing more than free idle (INSUFFICIENT_FREE_IDLE) and expected < advance", () => {
    const p = createPool();
    deposit(p, 50n * HBAR);
    expect(() => financeClaim(p, 90n * HBAR, 100n * HBAR, 90n, 0n)).to.throw("INSUFFICIENT_FREE_IDLE");
    expect(() => financeClaim(p, 40n * HBAR, 30n * HBAR, 90n, 0n)).to.throw("EXPECTED_LT_ADVANCE");
  });

  it("M3: financeClaim respects the senior queue earmark — cannot deploy queued-owed idle", () => {
    // idle=100, but 80 is owed to the senior redemption queue (queuedShares). Raw idle (100) would
    // pass a 90 advance, stranding the queue; free idle (20) must reject it.
    const p = createPool();
    deposit(p, 100n * HBAR);
    p.queuedShares = 80n * HBAR; // HBAR already owed to partially-filled redeemers (senior, I10)
    expect(() => financeClaim(p, 90n * HBAR, 100n * HBAR, 90n, 0n)).to.throw("INSUFFICIENT_FREE_IDLE");
    // financing within free idle (<= 20) is fine and does not touch the queued earmark.
    const before = p.queuedShares;
    financeClaim(p, 20n * HBAR, 25n * HBAR, 90n, 0n);
    expect(p.queuedShares).to.equal(before);
  });
});

describe("WaferVault — deposit guards the derived share amount at the HTS int64 boundary (H1)", () => {
  it("reverts SHARES_OVERFLOW when an impaired pool (NAV<<1) makes a legal deposit mint > int64 max", () => {
    // A 1000-HBAR pool (totalShares ~ 1e11) whose receivable is wiped to ~the dead seed: netAssets
    // collapses, so shares = assets*totalShares/netAssets explodes past int64.max for a legal
    // (<= uint64.max tinybar) deposit. The guard must catch it instead of truncating at the HTS cast.
    const p = createPool();
    deposit(p, 1000n * HBAR); // totalShares ~ 1000e8 + dead seed
    p.receivable = 0n;
    p.idle = DEAD_SEED_TINYBAR; // netAssets ~ tiny -> NAV << 1
    const big = UINT64_MAX; // a legal-but-large deposit (passes the msg.value guard)
    expect(() => deposit(p, big)).to.throw("SHARES_OVERFLOW");
  });

  it("a normal deposit at healthy NAV is well under the int64 ceiling", () => {
    const p = createPool();
    const { sharesMinted } = deposit(p, 100n * HBAR);
    expect(sharesMinted).to.be.lessThan(MAX_HTS_AMOUNT);
  });
});

describe("WaferVault — time-accretion target formula (SPEC §5.1)", () => {
  // target = advance + (expected - advance) * min(elapsed, term) / term
  function target(advance: bigint, expected: bigint, elapsed: bigint, term: bigint): bigint {
    const capped = elapsed < term ? elapsed : term;
    return advance + ((expected - advance) * capped) / term;
  }

  it("target == advance at t=0 (no spread recognized yet)", () => {
    expect(target(90n, 100n, 0n, 90n)).to.equal(90n);
  });
  it("target accretes linearly across the term", () => {
    expect(target(90n * HBAR, 100n * HBAR, 30n, 90n)).to.equal(9333333333n); // 90 + 10*30/90 = 93.33..
    expect(target(90n * HBAR, 100n * HBAR, 60n, 90n)).to.equal(9666666666n); // 96.66..
    expect(target(90n * HBAR, 100n * HBAR, 90n, 90n)).to.equal(100n * HBAR); // 100 at term
  });
  it("target is CLAMPED at term — elapsed past term cannot over-recognize (I6)", () => {
    expect(target(90n * HBAR, 100n * HBAR, 9000n, 90n)).to.equal(100n * HBAR); // still 100, not 1000s
  });
});

describe("WaferVault — single deal, amortized accrual, no double-count (SPEC §5.3)", () => {
  // deposit 100 -> finance 90/100 over 90 -> settle 30@30, 30@60, 40@90 -> Repaid, NAV 1.10.
  // Buggy (old) contract would show 100+100 => NAV 2.0 (principal counted twice).
  it("reproduces the SPEC §5.3 single-deal walk to the digit, NAV peaks at 1.10 (never 2.0)", () => {
    const p = createPool();
    const seed = DEAD_SEED_TINYBAR;
    // exact-balance pool (drop the tiny seed noise by deriving NAV against the round investor stake)
    deposit(p, 100n * HBAR);
    const shares = p.totalShares; // dead + investor
    expect(navPerShare(p)).to.equal(ONE); // 1.000

    const c = financeClaim(p, 90n * HBAR, 100n * HBAR, 90n, 0n);
    expect(navPerShare(p)).to.equal(ONE); // 1.000 FLAT (I3)

    settleRewards(p, c, 30n * HBAR, 30n); // target 93.33, carry 63.33, recv 63.33, idle 10+30
    // assets = idle(40 + seed) + recv(63.33) ; against ~100 shares -> ~1.03333 (NAV is derived,
    // so we assert the exact derived value AND that it sits at ~1.0333 within seed-dust tolerance).
    expect(navPerShare(p)).to.equal((totalAssets(p) * ONE) / shares);
    expect(navPerShare(p)).to.be.closeToBig(103333333n, 10000n); // ~1.0333 (seed-dust + rounding)
    expect(c.carry).to.equal(9333333333n - 30n * HBAR); // target - settled

    settleRewards(p, c, 30n * HBAR, 60n); // target 96.66, carry 36.66
    expect(navPerShare(p)).to.be.closeToBig(106666666n, 10000n); // ~1.0667

    settleRewards(p, c, 40n * HBAR, 90n); // settled 100 >= expected -> Repaid, carry 0
    expect(c.status).to.equal("Repaid");
    expect(c.carry).to.equal(0n);
    expect(p.receivable).to.equal(0n); // I4: no active claims left
    // idle = seed + 100 (deposit) - 90 (advance paid out) + 100 (rewards routed in) = seed + 110 HBAR
    expect(p.idle).to.equal(seed + 100n * HBAR - 90n * HBAR + 100n * HBAR);
    // NAV peaks at ~1.10, NEVER 2.0
    expect(navPerShare(p)).to.be.closeToBig(11n * ONE / 10n, 200n);
    expect(navPerShare(p) < 2n * ONE).to.equal(true);
  });
});

describe("WaferVault — BLENDED 2-claim, different APR (the product premise, SPEC §5.3)", () => {
  // deposit 200 -> Deal A 90/100 (~11%), Deal B 50/60 (20%) -> finance both -> NAV 1.0.
  // @t45 settle A 50, B 30 -> NAV 1.05.  @t90 settle A 50, B 30 -> both Repaid -> NAV 1.10.
  it("blends two different-APR deals into one pool NAV: 1.00 -> 1.05 -> 1.10", () => {
    const p = createPool();
    deposit(p, 200n * HBAR);
    const shares = p.totalShares;
    expect(navPerShare(p)).to.equal(ONE); // 1.00

    const a = financeClaim(p, 90n * HBAR, 100n * HBAR, 90n, 0n);
    const b = financeClaim(p, 50n * HBAR, 60n * HBAR, 90n, 0n);
    // idle = seed + 200 - 90 - 50 = 60+seed ; recv = 140 ; NAV flat 1.0 (I3)
    expect(p.receivable).to.equal(140n * HBAR);
    expect(p.receivable).to.equal(sumActiveCarry([a, b])); // I4
    expect(navPerShare(p)).to.equal(ONE);

    // @t45 settle A 50, B 30
    settleRewards(p, a, 50n * HBAR, 45n); // A target = 90 + 10*45/90 = 95 ; carry = 95-50 = 45
    settleRewards(p, b, 30n * HBAR, 45n); // B target = 50 + 10*45/90 = 55 ; carry = 55-30 = 25
    expect(a.carry).to.equal(45n * HBAR);
    expect(b.carry).to.equal(25n * HBAR);
    expect(p.receivable).to.equal(70n * HBAR); // 45 + 25
    expect(p.receivable).to.equal(sumActiveCarry([a, b])); // I4
    // assets = idle(60+seed + 80) + recv(70) = 210+seed ; / 200 shares (+dead) -> ~1.05
    expect(navPerShare(p)).to.equal((totalAssets(p) * ONE) / shares);
    expect(navPerShare(p)).to.be.closeToBig(105n * ONE / 100n, 200n);

    // @t90 settle A 50 (->Repaid), B 30 (->Repaid)
    settleRewards(p, a, 50n * HBAR, 90n); // settled 100 >= 100 -> Repaid
    settleRewards(p, b, 30n * HBAR, 90n); // settled 60 >= 60 -> Repaid
    expect(a.status).to.equal("Repaid");
    expect(b.status).to.equal("Repaid");
    expect(p.receivable).to.equal(0n);
    expect(navPerShare(p)).to.be.closeToBig(11n * ONE / 10n, 200n); // 1.10 blended
    // blended pool return = 10% (20 HBAR spread over 200) — the 11% & 20% per-deal APRs absorbed.
  });
});

describe("WaferVault — default writes down CARRY, not advance (SPEC §5.1 / §5.3)", () => {
  it("from the blend @t45 (NAV 1.05), B defaults -> loss == carryB (25), NAV 0.925", () => {
    const p = createPool();
    deposit(p, 200n * HBAR);
    const shares = p.totalShares;
    const a = financeClaim(p, 90n * HBAR, 100n * HBAR, 90n, 0n);
    const b = financeClaim(p, 50n * HBAR, 60n * HBAR, 90n, 0n);
    settleRewards(p, a, 50n * HBAR, 45n); // carryA 45
    settleRewards(p, b, 30n * HBAR, 45n); // carryB 25
    const navBefore = navPerShare(p);
    const recvBefore = p.receivable;

    const { loss } = markDefault(p, b);

    expect(loss).to.equal(25n * HBAR); // == carryB, the amortized book value
    expect(b.status).to.equal("Defaulted");
    expect(b.carry).to.equal(0n);
    // advance was NOT touched as a write-down field — realized income (the 30 already settled, plus
    // A's carry) is preserved. Receivable falls by exactly the carry, not by the principal.
    expect(p.receivable).to.equal(recvBefore - 25n * HBAR); // 70 - 25 = 45
    expect(p.receivable).to.equal(sumActiveCarry([a, b])); // only A still active (carry 45) — I4
    // NAV: assets = idle(140+seed) + recv(45) = 185+seed ; /200 -> ~0.925
    expect(navPerShare(p)).to.equal((totalAssets(p) * ONE) / shares);
    expect(navPerShare(p)).to.be.closeToBig(925n * ONE / 1000n, 200n);
    expect(navPerShare(p) < navBefore).to.equal(true);
    // Investors keep the cash already received (idle still holds the 80 of settled rewards).
    expect(p.idle).to.be.closeToBig(140n * HBAR, DEAD_SEED_TINYBAR + 1n);
  });

  it("default cannot exceed the carry it writes down (no over-write of receivable)", () => {
    const p = createPool();
    deposit(p, 100n * HBAR);
    const c = financeClaim(p, 90n * HBAR, 100n * HBAR, 90n, 0n);
    // mid-accrual: carry < advance? carry == advance at t0, decays as settled lands.
    settleRewards(p, c, 10n * HBAR, 30n); // target 93.33, carry 83.33
    const recvBefore = p.receivable;
    const { loss } = markDefault(p, c);
    expect(loss).to.equal(c.advance + (10n * HBAR / 3n) - 10n * HBAR + 0n - 0n); // == prior carry
    expect(loss).to.equal(recvBefore); // single claim -> writes down exactly the whole receivable
    expect(p.receivable).to.equal(0n);
  });

  it("markDefault on a non-Active claim reverts (cannot resurrect/double-default)", () => {
    const p = createPool();
    deposit(p, 100n * HBAR);
    const c = financeClaim(p, 90n * HBAR, 100n * HBAR, 90n, 0n);
    markDefault(p, c);
    expect(() => markDefault(p, c)).to.throw("CLAIM_NOT_ACTIVE");
  });
});

describe("WaferVault — repaid-residual recognition + clamp at expected (I6)", () => {
  it("recognized income per claim never exceeds expected - advance even on overshoot", () => {
    const p = createPool();
    deposit(p, 100n * HBAR);
    const c = financeClaim(p, 90n * HBAR, 100n * HBAR, 90n, 0n);
    // single huge settle PAST expected (overshoot): settled 140 >> expected 100.
    settleRewards(p, c, 140n * HBAR, 1000n); // elapsed past term, clamps target at 100
    expect(c.status).to.equal("Repaid");
    expect(c.carry).to.equal(0n);
    // recognized income = receivable lift = expected - advance = 10 HBAR, NOT 50.
    // the extra 40 of overshoot is just idle cash (it inflates idle, but NOT recognized as carry).
    expect(p.receivable).to.equal(0n);
    // total recognized appreciation = settled spread capped at expected: idle holds the surplus.
    // assets = idle (everything that came in) ; NAV reflects the realized cash, not a carry overshoot.
    expect(totalAssets(p)).to.equal(p.idle);
  });

  it("settle exactly at expected repays with zero residual carry", () => {
    const p = createPool();
    deposit(p, 100n * HBAR);
    const c = financeClaim(p, 90n * HBAR, 100n * HBAR, 90n, 0n);
    settleRewards(p, c, 100n * HBAR, 90n); // settled == expected exactly
    expect(c.status).to.equal("Repaid");
    expect(c.carry).to.equal(0n);
    expect(p.receivable).to.equal(0n);
  });

  it("a tiny early settle does NOT mark repaid (must reach expected)", () => {
    const p = createPool();
    deposit(p, 100n * HBAR);
    const c = financeClaim(p, 90n * HBAR, 100n * HBAR, 90n, 0n);
    settleRewards(p, c, 1n * HBAR, 5n);
    expect(c.status).to.equal("Active");
    expect(c.carry > 0n).to.equal(true);
  });
});

describe("WaferVault — settleRewards accrual cap & reward HBAR raises idle", () => {
  it("each settle lifts receivable only by the carry delta (no double-count across drips)", () => {
    const p = createPool();
    deposit(p, 100n * HBAR);
    const c = financeClaim(p, 90n * HBAR, 100n * HBAR, 90n, 0n);
    let prevRecv = p.receivable; // 90
    const navStart = navPerShare(p);

    // many small drips: NAV must be MONOTONE non-decreasing and bounded below 2.0 throughout.
    // 10 drips of 10 HBAR == 100 HBAR settled == expected, so the claim repays on the last one.
    let prevNav = navStart;
    for (let i = 1; i <= 10; i++) {
      settleRewards(p, c, 10n * HBAR, BigInt(i * 9)); // elapsed 9,18,...,90 (term = 90)
      const nav = navPerShare(p);
      expect(nav >= prevNav).to.equal(true); // monotone up
      expect(nav < 2n * ONE).to.equal(true); // never the buggy 2.0
      prevNav = nav;
      // receivable lift per drip = carry delta, always <= the spread, never the principal
      expect(p.receivable <= prevRecv + 10n * HBAR).to.equal(true);
      prevRecv = p.receivable;
    }
    expect(c.status).to.equal("Repaid"); // settled 100 >= expected 100
    expect(navPerShare(p)).to.be.closeToBig(11n * ONE / 10n, 10000n); // peaks ~1.10
  });

  it("reward cash always increases idle by exactly msg.value", () => {
    const p = createPool();
    deposit(p, 100n * HBAR);
    const c = financeClaim(p, 90n * HBAR, 100n * HBAR, 90n, 0n);
    const idleBefore = p.idle;
    settleRewards(p, c, 7n * HBAR, 10n);
    expect(p.idle).to.equal(idleBefore + 7n * HBAR);
  });

  it("settleRewards rejects zero and over-uint64 values", () => {
    const p = createPool();
    deposit(p, 100n * HBAR);
    const c = financeClaim(p, 90n * HBAR, 100n * HBAR, 90n, 0n);
    expect(() => settleRewards(p, c, 0n, 10n)).to.throw("ZERO_REWARD");
    expect(() => settleRewards(p, c, UINT64_MAX + 1n, 10n)).to.throw("VALUE_TOO_LARGE");
  });
});

describe("WaferVault — redemption: instant fill, queue, claimRedemption FIFO (D5)", () => {
  it("fully-liquid redeem pays instantly with no queue entry", () => {
    const p = createPool();
    deposit(p, 100n * HBAR); // 100 idle
    const queue: RedemptionRequest[] = [];
    const { filled, queued } = redeem(p, queue, "alice", 0, 10n * ONE);
    expect(queued).to.equal(0n);
    expect(filled).to.equal(10n * HBAR);
    expect(queue.length).to.equal(0);
  });

  it("redeem against deployed (illiquid) liquidity instant-fills idle and queues the remainder", () => {
    const p = createPool();
    deposit(p, 100n * HBAR);
    // finance 90 -> idle ~10, recv 90. NAV still 1.0, but only ~10 HBAR is liquid.
    financeClaim(p, 90n * HBAR, 100n * HBAR, 90n, 0n);
    const liquidBefore = liquidAssets(p);
    const queue: RedemptionRequest[] = [];

    // alice redeems all her shares (worth ~100 HBAR) — only ~10 is fillable now.
    const aliceShares = p.totalShares - DEAD_SHARES;
    const assetsOwed = convertToAssets(p, aliceShares);
    const { filled, queued } = redeem(p, queue, "alice", 0, aliceShares);

    expect(filled).to.equal(liquidBefore); // instant up to liquid (I7: cash only)
    expect(queued).to.equal(assetsOwed - liquidBefore);
    expect(queue.length).to.equal(1);
    expect(queue[0].assets).to.equal(queued);
    expect(p.queuedShares).to.equal(queued);
    // all shares burned now even though only part was paid
    expect(p.totalShares).to.equal(DEAD_SHARES);
  });

  it("claimRedemption pays a queued request once a settle refills idle; FIFO across two requests", () => {
    const p = createPool();
    // two investors, then deploy liquidity so redeems queue.
    deposit(p, 100n * HBAR);
    const c = financeClaim(p, 95n * HBAR, 110n * HBAR, 90n, 0n); // idle ~5, recv 95
    const queue: RedemptionRequest[] = [];

    // alice redeems part -> instant fills the ~5 idle, queues the rest.
    const shares = p.totalShares - DEAD_SHARES;
    redeem(p, queue, "alice", 0, shares); // request 0 queued
    expect(queue.length).to.equal(1);
    const owed0 = queue[0].assets;

    // before refill, claimRedemption reverts (no idle).
    expect(() => claimRedemption(p, queue, 0)).to.throw("NO_LIQUID");

    // a settle floods idle with reward cash -> now claimable.
    settleRewards(p, c, 110n * HBAR, 90n); // repays fully, idle jumps
    const paid = claimRedemption(p, queue, 0);
    expect(paid).to.equal(owed0);
    expect(queue[0].filled).to.equal(true);
    expect(p.queuedShares).to.equal(0n);

    // double-claim reverts.
    expect(() => claimRedemption(p, queue, 0)).to.throw("ALREADY_FILLED");
  });

  it("CRITICAL: a partially-filled redeemer's QUEUED backing does NOT inflate remaining holders' NAV", () => {
    // Reproduces the review's reported NAV-inflation: two depositors of 100 each, finance drains
    // idle to ~10 / recv ~190. Investor 1 redeems ALL their shares -> ~10 filled + ~90 queued (all
    // shares burned). The buggy (gross) math attributed the queued 90 of still-in-receivable backing
    // to the remaining holder -> NAV jumped 1.0 -> ~1.9. The fix nets queuedShares out of the asset
    // base, so the remaining holder's NAV stays ~1.0 and the 90 stays earmarked for the queue.
    const p = createPool();
    deposit(p, 100n * HBAR); // alice
    deposit(p, 100n * HBAR); // bob
    const sharesEach = (p.totalShares - DEAD_SHARES) / 2n; // each investor owns ~half
    expect(navPerShare(p)).to.equal(ONE); // 1.0

    // finance 190 -> idle ~10, recv 190, NAV flat 1.0.
    financeClaim(p, 190n * HBAR, 210n * HBAR, 90n, 0n);
    expect(navPerShare(p)).to.be.closeToBig(ONE, 1000n);

    const liquidBefore = liquidAssets(p); // ~10 HBAR (idle, no queue yet)
    const queue: RedemptionRequest[] = [];

    // alice redeems all her shares (~100 HBAR of value); only ~10 is fillable now.
    const aliceOwed = convertToAssets(p, sharesEach);
    const { filled, queued } = redeem(p, queue, "alice", 0, sharesEach);
    expect(filled).to.equal(liquidBefore);
    expect(queued).to.equal(aliceOwed - liquidBefore); // ~90 HBAR queued
    expect(p.queuedShares).to.equal(queued);

    // The remaining holder (bob) must NOT have inherited alice's queued backing.
    const bobNav = navPerShare(p);
    expect(bobNav).to.be.closeToBig(ONE, 5000n); // ~1.0, NOT ~1.9
    expect(bobNav < 12n * ONE / 10n).to.equal(true); // hard ceiling well below the buggy 1.9

    // netAssets backing bob's live shares == his pro-rata value; the queued 90 is excluded.
    const bobAssets = convertToAssets(p, sharesEach);
    expect(bobAssets).to.be.closeToBig(aliceOwed, aliceOwed / 20n); // bob ≈ alice's original value

    // gross totalAssets still includes the queued backing (I2 identity preserved), but NET excludes it.
    expect(totalAssets(p)).to.equal(p.idle + p.receivable);
    expect(netAssets(p)).to.equal(totalAssets(p) - p.queuedShares);
  });

  it("claimRedemption paying the queue leaves remaining-holder NAV unchanged (queue is senior)", () => {
    const p = createPool();
    deposit(p, 100n * HBAR);
    deposit(p, 100n * HBAR);
    const sharesEach = (p.totalShares - DEAD_SHARES) / 2n;
    const c = financeClaim(p, 190n * HBAR, 210n * HBAR, 90n, 0n);
    const queue: RedemptionRequest[] = [];
    redeem(p, queue, "alice", 0, sharesEach); // queues ~90
    const navBeforeClaim = navPerShare(p);

    // settle floods idle so the queue is claimable; then pay alice's queued request.
    settleRewards(p, c, 200n * HBAR, 45n); // idle jumps, recv accretes
    const navAfterSettle = navPerShare(p);
    expect(navAfterSettle >= navBeforeClaim).to.equal(true); // yield lifts the LIVE holders only

    const navBeforePay = navPerShare(p);
    claimRedemption(p, queue, 0); // pay alice's queued ~90 from idle
    // paying the senior liability nets idle AND queuedShares down equally -> NAV unchanged.
    expect(navPerShare(p)).to.equal(navBeforePay);
    expect(p.queuedShares).to.equal(0n);
  });

  it("minBufferBps reserves idle so instant fill respects the buffer (I7)", () => {
    const p = createPool();
    deposit(p, 100n * HBAR);
    p.minBufferBps = 2000n; // keep 20% of (idle+recv) free
    // reserve = 20% of ~100 = ~20 ; liquid = idle - reserve ≈ 80
    const liquid = liquidAssets(p);
    expect(liquid).to.be.closeToBig(80n * HBAR, DEAD_SEED_TINYBAR + 1n);
    const queue: RedemptionRequest[] = [];
    const shares = p.totalShares - DEAD_SHARES;
    const { filled, queued } = redeem(p, queue, "alice", 0, shares);
    expect(filled).to.equal(liquid); // capped at liquid, NOT the full idle
    expect(queued > 0n).to.equal(true); // remainder queued behind the buffer
  });
});

describe("WaferVault — redeem is exact, no custom fee (full-share burn, payout == previewRedeem)", () => {
  // The share token ships with NO custom fee (D11: a fractional fee on Hedera is assessed on every
  // non-collector transfer and reverts INVALID_ACCOUNT_ID, breaking redeem operator->vault and the
  // AMM). So redeem is a plain transfer+burn: the payout the contract computes (convertToAssets) is
  // the FULL proportional value — nothing is shaved, and burning exactly `shares` never over-draws.
  it("redeem payout equals previewRedeem exactly (no fee skim)", () => {
    const p = createPool();
    deposit(p, 100n * HBAR);
    p.receivable += 23n * HBAR; // some realized yield -> NAV > 1
    const shares = 7n * ONE;
    const preview = convertToAssets(p, shares); // == previewRedeem
    const queue: RedemptionRequest[] = [];
    const { filled, queued } = redeem(p, queue, "alice", 0, shares);
    expect(filled + queued).to.equal(preview); // exact: nothing shaved off
  });

  it("full-share burn nets to zero (no fee would inflate the pulled amount)", () => {
    // With no fee, burning exactly `shares` is correct (a non-exempt fractional fee would require
    // pulling shares*(1+fee) and over-draw -> BURN_SHARE_FAIL — the failure mode D11 avoids).
    const p = createPool();
    const minted = deposit(p, 50n * HBAR).sharesMinted;
    const queue: RedemptionRequest[] = [];
    redeem(p, queue, "alice", 0, minted); // burns exactly `minted`, no fee surcharge
    expect(p.totalShares).to.equal(DEAD_SHARES); // back to just the dead position
  });
});

describe("WaferVault — invariants hold across a full lifecycle (SPEC §5.2)", () => {
  it("I2/I3/I4/I8 hold step-by-step through deposit -> finance -> settle -> repaid", () => {
    const p = createPool();
    const claims: Claim[] = [];

    const check = () => {
      expect(totalAssets(p)).to.equal(p.idle + p.receivable); // I2
      expect(p.receivable).to.equal(sumActiveCarry(claims)); // I4
      if (p.totalShares === 0n) expect(navPerShare(p)).to.equal(ONE); // I8
      // I5: carry bounds for every claim
      for (const c of claims) {
        const bound = c.advance > c.expected ? c.advance : c.expected;
        expect(c.carry >= 0n && c.carry <= bound).to.equal(true);
        if (c.status !== "Active") expect(c.carry).to.equal(0n);
      }
    };

    check();
    deposit(p, 100n * HBAR);
    const navAfterDeposit = navPerShare(p);
    check();

    const c = financeClaim(p, 90n * HBAR, 100n * HBAR, 90n, 0n);
    claims.push(c);
    expect(navPerShare(p)).to.equal(navAfterDeposit); // I3: finance neutral
    check();

    settleRewards(p, c, 50n * HBAR, 45n);
    check();
    settleRewards(p, c, 50n * HBAR, 90n);
    check();
    expect(c.status).to.equal("Repaid");
  });
});

// --- a small bigint-aware chai helper for the closeTo assertions above ----------
import chai from "chai";
chai.use((chaiInstance) => {
  chaiInstance.Assertion.addMethod("closeToBig", function (expected: bigint, delta: bigint) {
    const actual = this._obj as bigint;
    const diff = actual > expected ? actual - expected : expected - actual;
    this.assert(
      diff <= delta,
      `expected ${actual} to be within ${delta} of ${expected} (diff ${diff})`,
      `expected ${actual} NOT to be within ${delta} of ${expected}`,
      expected,
      actual,
    );
  });
});
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Chai {
    interface Assertion {
      closeToBig(expected: bigint, delta: bigint): Assertion;
    }
  }
}
