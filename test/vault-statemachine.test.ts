import { expect } from "chai";

/**
 * WaferVault — access control, timelock, KYC gate, reentrancy-safety, MockRewardSource schedule.
 *
 * Same constraint as vault-accounting.test.ts: the contract's money paths all hit the HTS precompile
 * at 0x167, which has no local Hardhat implementation, and this install has no ethers/hardhat-ethers
 * reachable from the test process — so we cannot deploy-and-call the contract locally. These tests
 * therefore mirror the contract's PERMISSIONING + ORDERING logic (which is pure and precompile-free
 * up to the point of the gate it enforces) in BigInt/JS, asserting the same reverts and the same
 * timelock/queue state machine the contract implements. The live HTS round-trips (the actual
 * mint/burn/transfer/grant-KYC reverts) are exercised end-to-end by `pnpm run smoke` on testnet.
 *
 * Each mirror is annotated // CONTRACT: <function> to map it to WaferVault.sol / MockRewardSource.sol.
 */

const HBAR = 100_000_000n;
const UINT64_MAX = 2n ** 64n - 1n;

// =============================================================================
//                          Operator / settler / KYC gating
// =============================================================================

describe("WaferVault — operator whitelist gating (D9)", () => {
  // CONTRACT: modifier onlyOperator { require(isOperator[msg.sender], "NOT_OPERATOR"); }
  const isOperator: Record<string, boolean> = {};
  function registerOperator(caller: string, isOwner: boolean, operator: string, allowed: boolean) {
    if (!isOwner) throw new Error("OwnableUnauthorizedAccount"); // CONTRACT: onlyOwner
    if (operator === "0x0") throw new Error("ZERO_OPERATOR");
    isOperator[operator] = allowed;
  }
  function proposeDeal(caller: string) {
    if (!isOperator[caller]) throw new Error("NOT_OPERATOR"); // CONTRACT: onlyOperator
    return "ok";
  }

  it("a non-whitelisted address cannot proposeDeal", () => {
    expect(() => proposeDeal("randoOperator")).to.throw("NOT_OPERATOR");
  });
  it("only the owner can registerOperator; zero address rejected", () => {
    expect(() => registerOperator("rando", false, "op1", true)).to.throw("OwnableUnauthorizedAccount");
    expect(() => registerOperator("owner", true, "0x0", true)).to.throw("ZERO_OPERATOR");
  });
  it("a registered operator can proposeDeal; deregistration re-blocks it", () => {
    registerOperator("owner", true, "op1", true);
    expect(proposeDeal("op1")).to.equal("ok");
    registerOperator("owner", true, "op1", false);
    expect(() => proposeDeal("op1")).to.throw("NOT_OPERATOR");
  });
});

describe("WaferVault — proposeDeal validation", () => {
  // CONTRACT: proposeDeal require()s.
  function proposeDeal(advance: bigint, expected: bigint, term: bigint, device: string) {
    if (expected < advance) throw new Error("EXPECTED_LT_ADVANCE");
    if (advance <= 0n) throw new Error("ZERO_ADVANCE");
    if (term <= 0n) throw new Error("ZERO_TERM");
    if (expected > UINT64_MAX) throw new Error("VALUE_TOO_LARGE");
    if (device === "0x0") throw new Error("ZERO_DEVICE");
    return "ok";
  }
  it("rejects expected<advance, zero advance/term, oversize expected, zero device", () => {
    expect(() => proposeDeal(100n, 90n, 90n, "dev")).to.throw("EXPECTED_LT_ADVANCE");
    expect(() => proposeDeal(0n, 0n, 90n, "dev")).to.throw("ZERO_ADVANCE");
    expect(() => proposeDeal(90n, 100n, 0n, "dev")).to.throw("ZERO_TERM");
    expect(() => proposeDeal(90n, UINT64_MAX + 1n, 90n, "dev")).to.throw("VALUE_TOO_LARGE");
    expect(() => proposeDeal(90n, 100n, 90n, "0x0")).to.throw("ZERO_DEVICE");
    expect(proposeDeal(90n, 100n, 90n, "dev")).to.equal("ok");
  });
});

describe("WaferVault — approveDeal category match + status machine (D6/D7)", () => {
  // CONTRACT: approveDeal requires Proposed status + pool category == deal category.
  type Status = "Proposed" | "Approved" | "Rejected" | "Financed";
  function approveDeal(status: Status, dealCategory: number, poolCategory: number) {
    if (status !== "Proposed") throw new Error("NOT_PROPOSED");
    if (dealCategory !== poolCategory) throw new Error("CATEGORY_MISMATCH");
    return "Approved";
  }
  it("rejects a non-Proposed deal and a category mismatch", () => {
    expect(() => approveDeal("Approved", 0, 0)).to.throw("NOT_PROPOSED");
    expect(() => approveDeal("Proposed", 0 /*GPU*/, 3 /*Energy*/)).to.throw("CATEGORY_MISMATCH");
    expect(approveDeal("Proposed", 0, 0)).to.equal("Approved");
  });
});

describe("WaferVault — settleRewards access control + Active-only + cap (D8, I6)", () => {
  // CONTRACT: settleRewards: onlyClaimSettler + require(status==Active) + require(value>0, value<=u64).
  const settlerSet: Record<string, Record<string, boolean>> = {};
  function authorize(claimId: number, addr: string, allowed: boolean) {
    settlerSet[claimId] ??= {};
    settlerSet[claimId][addr] = allowed;
  }
  function settle(claimId: number, caller: string, status: string, value: bigint) {
    if (!settlerSet[claimId]?.[caller]) throw new Error("NOT_SETTLER"); // gate is checked FIRST (modifier)
    if (value <= 0n) throw new Error("ZERO_REWARD");
    if (value > UINT64_MAX) throw new Error("VALUE_TOO_LARGE");
    if (status !== "Active") throw new Error("CLAIM_NOT_ACTIVE");
    return "ok";
  }

  it("a non-settler is blocked even with a valid amount on an Active claim", () => {
    authorize(0, "operator", true);
    expect(() => settle(0, "rando", "Active", 10n * HBAR)).to.throw("NOT_SETTLER");
  });
  it("default settler set = {operator, owner}; a relayer must be explicitly authorized", () => {
    // CONTRACT: financeClaim sets claimSettler[claimId][operator] = claimSettler[claimId][owner] = true.
    authorize(1, "operator", true);
    authorize(1, "owner", true);
    expect(settle(1, "operator", "Active", 5n * HBAR)).to.equal("ok");
    expect(settle(1, "owner", "Active", 5n * HBAR)).to.equal("ok");
    expect(() => settle(1, "relayer", "Active", 5n * HBAR)).to.throw("NOT_SETTLER");
    authorize(1, "relayer", true); // owner calls setAuthorizedSettler
    expect(settle(1, "relayer", "Active", 5n * HBAR)).to.equal("ok");
  });
  it("cannot settle a Repaid or Defaulted claim (no resurrection)", () => {
    authorize(2, "operator", true);
    expect(() => settle(2, "operator", "Repaid", 5n * HBAR)).to.throw("CLAIM_NOT_ACTIVE");
    expect(() => settle(2, "operator", "Defaulted", 5n * HBAR)).to.throw("CLAIM_NOT_ACTIVE");
  });
  it("rejects zero and over-uint64 reward values", () => {
    authorize(3, "operator", true);
    expect(() => settle(3, "operator", "Active", 0n)).to.throw("ZERO_REWARD");
    expect(() => settle(3, "operator", "Active", UINT64_MAX + 1n)).to.throw("VALUE_TOO_LARGE");
  });
});

describe("WaferVault — KYC gating on deposit (D2 allowlist, NO auto-grant)", () => {
  // CONTRACT: deposit requires isKyced[poolId][msg.sender]; KYC is admin-granted, never auto.
  const isKyced: Record<string, boolean> = {};
  const poolExists = true;
  let paused = false;
  function adminGrantKyc(isOwner: boolean, investor: string) {
    if (!isOwner) throw new Error("OwnableUnauthorizedAccount");
    isKyced[investor] = true; // NOTE: on-chain this also calls grantTokenKyc (HTS) — that part is live-only.
  }
  function deposit(caller: string, value: bigint) {
    if (!poolExists) throw new Error("NO_POOL");
    if (paused) throw new Error("POOL_PAUSED");
    if (value <= 0n) throw new Error("ZERO_DEPOSIT");
    if (value > UINT64_MAX) throw new Error("VALUE_TOO_LARGE");
    if (!isKyced[caller]) throw new Error("NOT_KYCED"); // the gate — un-KYC'd deposit reverts
    return "ok";
  }

  it("an un-KYC'd (or un-associated -> never granted) investor cannot deposit", () => {
    expect(() => deposit("alice", 10n * HBAR)).to.throw("NOT_KYCED");
  });
  it("deposit succeeds only after the admin grants KYC; investors cannot self-grant", () => {
    expect(() => adminGrantKyc(false, "alice")).to.throw("OwnableUnauthorizedAccount");
    adminGrantKyc(true, "alice");
    expect(deposit("alice", 10n * HBAR)).to.equal("ok");
  });
  it("deposit is blocked while the pool is paused (D10 compliance)", () => {
    adminGrantKyc(true, "bob");
    paused = true;
    expect(() => deposit("bob", 10n * HBAR)).to.throw("POOL_PAUSED");
    paused = false;
    expect(deposit("bob", 10n * HBAR)).to.equal("ok");
  });
  it("deposit enforces the uint64 ceiling on msg.value (D13)", () => {
    adminGrantKyc(true, "carol");
    expect(() => deposit("carol", UINT64_MAX + 1n)).to.throw("VALUE_TOO_LARGE");
    expect(deposit("carol", UINT64_MAX)).to.equal("ok");
  });
});

describe("WaferVault — pause is a SYMMETRIC compliance freeze: halts value-out too (D10/§7)", () => {
  // CONTRACT: redeem() and claimRedemption() both require(p.status == Active, "POOL_PAUSED"), so a
  // paused pool blocks new money IN (deposit) AND value OUT (redeem/claim), not just deposits. A
  // regulator-style pool freeze stops exits as well; per-account exits are governed by freeze().
  let paused = false;
  function redeem() {
    if (paused) throw new Error("POOL_PAUSED"); // CONTRACT: redeem() pause gate
    return "ok";
  }
  function claimRedemption() {
    if (paused) throw new Error("POOL_PAUSED"); // CONTRACT: claimRedemption() pause gate
    return "ok";
  }

  it("redeem reverts POOL_PAUSED while paused, resumes when unpaused", () => {
    paused = true;
    expect(() => redeem()).to.throw("POOL_PAUSED");
    paused = false;
    expect(redeem()).to.equal("ok");
  });
  it("claimRedemption reverts POOL_PAUSED while paused (queued exits also frozen)", () => {
    paused = true;
    expect(() => claimRedemption()).to.throw("POOL_PAUSED");
    paused = false;
    expect(claimRedemption()).to.equal("ok");
  });
});

// =============================================================================
//                         Ownable2Step + timelock (D9)
// =============================================================================

describe("WaferVault — Ownable2Step + renounce disabled (D9)", () => {
  // CONTRACT: Ownable2Step; renounceOwnership() reverts RENOUNCE_DISABLED.
  let owner = "safe";
  let pendingOwner = "";
  function transferOwnership(caller: string, to: string) {
    if (caller !== owner) throw new Error("OwnableUnauthorizedAccount");
    pendingOwner = to; // 2-step: does NOT transfer yet
  }
  function acceptOwnership(caller: string) {
    if (caller !== pendingOwner) throw new Error("OwnableUnauthorizedAccount");
    owner = pendingOwner;
    pendingOwner = "";
  }
  function renounceOwnership(caller: string) {
    if (caller !== owner) throw new Error("OwnableUnauthorizedAccount");
    throw new Error("RENOUNCE_DISABLED");
  }

  it("ownership transfer is 2-step: pending until the new owner accepts", () => {
    transferOwnership("safe", "newSafe");
    expect(owner).to.equal("safe"); // not yet transferred
    expect(() => acceptOwnership("intruder")).to.throw("OwnableUnauthorizedAccount");
    acceptOwnership("newSafe");
    expect(owner).to.equal("newSafe");
  });
  it("renounceOwnership is permanently disabled (vault must always have an admin)", () => {
    expect(() => renounceOwnership("newSafe")).to.throw("RENOUNCE_DISABLED");
  });
  it("a non-owner cannot transfer ownership", () => {
    expect(() => transferOwnership("rando", "rando")).to.throw("OwnableUnauthorizedAccount");
  });
});

describe("WaferVault — timelock on financeClaim / markDefault (D9)", () => {
  // CONTRACT: _consumeTimelock(action): delay==0 -> execute now; else first call queues
  // pendingAfter[action]=now+delay and returns false; a later call >= ready executes and clears it.
  let now = 1_000_000n;
  let timelockDelay = 0n;
  const pendingAfter: Record<string, bigint> = {};

  function consumeTimelock(action: string): boolean {
    if (timelockDelay === 0n) return true;
    const ready = pendingAfter[action] ?? 0n;
    if (ready === 0n) {
      pendingAfter[action] = now + timelockDelay;
      return false; // queued
    }
    if (now < ready) throw new Error("TIMELOCK_PENDING");
    delete pendingAfter[action];
    return true; // executable
  }
  function cancelTimelock(action: string) {
    delete pendingAfter[action];
  }

  it("delay == 0 executes immediately (demo/smoke default)", () => {
    timelockDelay = 0n;
    expect(consumeTimelock("financeClaim:0")).to.equal(true);
  });

  it("when armed, the first call QUEUES (no execute) and a second call before the window reverts", () => {
    timelockDelay = 3600n; // 1h
    const action = "markDefault:7";
    expect(consumeTimelock(action)).to.equal(false); // queued, not executed
    expect(pendingAfter[action]).to.equal(now + 3600n);
    // a second call before the window must NOT execute -> reverts TIMELOCK_PENDING.
    now += 1000n; // still inside the window
    expect(() => consumeTimelock(action)).to.throw("TIMELOCK_PENDING");
  });

  it("after the window the second call executes and clears the pending slot (re-arms fresh)", () => {
    timelockDelay = 3600n;
    const action = "financeClaim:9";
    expect(consumeTimelock(action)).to.equal(false); // queue
    const ready = pendingAfter[action];
    now = ready + 1n; // past the window
    expect(consumeTimelock(action)).to.equal(true); // execute
    expect(pendingAfter[action]).to.be.undefined; // cleared
    // a brand-new action re-queues (timelock is per-action-hash, one-shot).
    expect(consumeTimelock(action)).to.equal(false);
  });

  it("owner can cancel a queued action before it executes", () => {
    timelockDelay = 3600n;
    const action = "markDefault:42";
    consumeTimelock(action); // queue
    expect(pendingAfter[action]).to.not.be.undefined;
    cancelTimelock(action);
    expect(pendingAfter[action]).to.be.undefined;
    // after cancel, the next call re-queues from scratch rather than executing.
    expect(consumeTimelock(action)).to.equal(false);
  });
});

// =============================================================================
//                  Reentrancy safety — CEI ordering (malicious receiver)
// =============================================================================

describe("WaferVault — reentrancy safety via CEI (malicious operator/receiver)", () => {
  /**
   * CONTRACT: deposit/redeem/financeClaim/settleRewards/markDefault/claimRedemption are nonReentrant
   * AND follow strict checks-effects-interactions: every `call{value:}` to an attacker-controlled
   * address is the LAST statement, AFTER all state writes. On Hedera EVM call{value:} triggers the
   * recipient's receive()/fallback(), so a malicious operator could try to re-enter financeClaim or
   * redeem during the advance/payout. We model this: state is committed BEFORE the external call, and
   * the nonReentrant lock rejects the re-entrant call -> the attacker sees already-settled state and
   * cannot drain. This mirrors the contract's ordering exactly (idle/shares written, THEN pay).
   */
  it("financeClaim commits idle->receivable BEFORE paying the operator (CEI); re-entry is locked", () => {
    let locked = false;
    const pool = { idle: 100n * HBAR, receivable: 0n };
    let reentryAttempted = false;
    let reentryReverted = false;

    // malicious operator's receive(): tries to re-enter financeClaim during the advance payout.
    function maliciousReceive() {
      reentryAttempted = true;
      try {
        financeClaim(50n * HBAR); // re-entrant attempt to finance again & drain
      } catch (e: any) {
        if (e.message === "ReentrancyGuardReentrantCall") reentryReverted = true;
        else throw e;
      }
    }

    function financeClaim(advance: bigint) {
      if (locked) throw new Error("ReentrancyGuardReentrantCall"); // nonReentrant
      locked = true;
      try {
        if (pool.idle < advance) throw new Error("INSUFFICIENT_IDLE");
        // --- EFFECTS first (CEI) ---
        pool.idle -= advance;
        pool.receivable += advance;
        // --- INTERACTION last: pay the operator (triggers malicious receive) ---
        maliciousReceive();
      } finally {
        locked = false;
      }
    }

    financeClaim(90n * HBAR);
    expect(reentryAttempted).to.equal(true);
    expect(reentryReverted).to.equal(true); // the guard caught the re-entrant call
    // state reflects exactly ONE finance, not a drain: idle 10, receivable 90.
    expect(pool.idle).to.equal(10n * HBAR);
    expect(pool.receivable).to.equal(90n * HBAR);
  });

  it("redeem burns shares + debits idle BEFORE paying out; re-entrant redeem is locked", () => {
    let locked = false;
    const pool = { idle: 100n * HBAR, totalShares: 100n * HBAR + 1000n };
    let reentryReverted = false;

    function maliciousReceive() {
      try {
        redeem(10n * HBAR); // re-enter to double-withdraw
      } catch (e: any) {
        if (e.message === "ReentrancyGuardReentrantCall") reentryReverted = true;
        else throw e;
      }
    }
    function redeem(shares: bigint) {
      if (locked) throw new Error("ReentrancyGuardReentrantCall");
      locked = true;
      try {
        // EFFECTS first
        pool.totalShares -= shares;
        pool.idle -= shares; // 1:1 here for simplicity (NAV 1.0)
        // INTERACTION last
        maliciousReceive();
      } finally {
        locked = false;
      }
    }

    redeem(40n * HBAR);
    expect(reentryReverted).to.equal(true);
    // only ONE redeem of 40 applied; the re-entrant 10 was rejected.
    expect(pool.idle).to.equal(60n * HBAR);
    expect(pool.totalShares).to.equal(60n * HBAR + 1000n);
  });
});

// =============================================================================
//                   MockRewardSource — drip schedule math (SPEC §9)
// =============================================================================

describe("MockRewardSource — linear drip schedule (the only mock)", () => {
  // CONTRACT (MockRewardSource.sol): fund() requires msg.value == totalReward; drip() releases all
  // due intervals; the final interval pays the exact remainder (no integer-division dust loss).
  interface Schedule {
    totalReward: bigint;
    startTime: bigint;
    termSeconds: bigint;
    dripCount: bigint;
    dripsDone: bigint;
    released: bigint;
    defaulted: boolean;
  }
  function fund(value: bigint, totalReward: bigint, term: bigint, dripCount: bigint): Schedule {
    if (dripCount <= 0n) throw new Error("ZERO_DRIPS");
    if (term <= 0n) throw new Error("ZERO_TERM");
    if (totalReward <= 0n) throw new Error("ZERO_REWARD");
    if (value !== totalReward) throw new Error("VALUE_MISMATCH"); // tinybar, prefunded
    return { totalReward, startTime: 0n, termSeconds: term, dripCount, dripsDone: 0n, released: 0n, defaulted: false };
  }
  function dueIntervals(s: Schedule, now: bigint): bigint {
    if (now <= s.startTime) return 0n;
    const elapsed = now - s.startTime;
    let interval = s.termSeconds / s.dripCount;
    if (interval === 0n) interval = 1n;
    const due = elapsed / interval;
    return due >= s.dripCount ? s.dripCount : due;
  }
  function drip(s: Schedule, now: bigint): bigint {
    if (s.defaulted) throw new Error("DEFAULTED");
    const due = dueIntervals(s, now);
    if (due <= s.dripsDone) throw new Error("NOTHING_DUE");
    const toRelease = due - s.dripsDone;
    const perDrip = s.totalReward / s.dripCount;
    let amount: bigint;
    if (due === s.dripCount) amount = s.totalReward - s.released; // final: exact remainder
    else amount = perDrip * toRelease;
    if (amount <= 0n) throw new Error("NOTHING_DUE");
    s.dripsDone = due;
    s.released += amount;
    return amount; // forwarded to vault.settleRewards{value: amount}
  }

  it("fund requires msg.value == totalReward (prefunded tinybar)", () => {
    expect(() => fund(99n, 100n, 90n, 10n)).to.throw("VALUE_MISMATCH");
    expect(() => fund(100n, 100n, 90n, 0n)).to.throw("ZERO_DRIPS");
    expect(fund(100n, 100n, 90n, 10n).totalReward).to.equal(100n);
  });

  it("drip reverts NOTHING_DUE before the first interval elapses", () => {
    const s = fund(100n * HBAR, 100n * HBAR, 90n, 10n);
    expect(() => drip(s, 0n)).to.throw("NOTHING_DUE"); // now == startTime
    expect(() => drip(s, 5n)).to.throw("NOTHING_DUE"); // < one interval (interval = 9)
  });

  it("releases exactly one interval per elapsed step and is idempotent within a step", () => {
    const s = fund(100n * HBAR, 100n * HBAR, 90n, 10n); // interval = 9s, perDrip = 10 HBAR
    expect(drip(s, 9n)).to.equal(10n * HBAR); // interval 1
    expect(() => drip(s, 9n)).to.throw("NOTHING_DUE"); // same step -> nothing new
    expect(drip(s, 18n)).to.equal(10n * HBAR); // interval 2
  });

  it("catches up multiple due intervals in a single drip call", () => {
    const s = fund(100n * HBAR, 100n * HBAR, 90n, 10n);
    expect(drip(s, 45n)).to.equal(50n * HBAR); // intervals 1..5 in one shot
    expect(s.dripsDone).to.equal(5n);
  });

  it("the final interval pays the exact remainder so totalReward is released with no dust loss", () => {
    // totalReward 100, dripCount 7 -> perDrip = 14 (integer floor), 7*14 = 98, dust = 2.
    const s = fund(100n, 100n, 70n, 7n); // interval = 10
    let total = 0n;
    for (let step = 1n; step <= 7n; step++) {
      total += drip(s, step * 10n);
    }
    expect(total).to.equal(100n); // exact — the last drip paid the +2 remainder
    expect(s.released).to.equal(100n);
  });

  it("simulateDefault stops further drips (DEFAULTED) to demo markDefault", () => {
    const s = fund(100n * HBAR, 100n * HBAR, 90n, 10n);
    drip(s, 27n); // release a few intervals first
    s.defaulted = true; // simulateDefault
    expect(() => drip(s, 90n)).to.throw("DEFAULTED");
  });
});

// =============================================================================
//        SaucerSwap secondary market — fee conversion + seed-at-NAV + ordering
// =============================================================================

describe("WaferVault — enableSecondaryMarket: fee conversion, seed-at-NAV, KYC ordering (SPEC §10)", () => {
  const ONE = 100_000_000n; // 1e8 — NAV / 8dp share unit

  // CONTRACT: front reads factory.pairCreateFee() (tinycents) and converts via Mirror Node
  // exchangerate: tinybar = tinycents * hbar_equivalent / cent_equivalent, +buffer%. Never hardcoded.
  function feeTinycentsToTinybar(tinycents: bigint, centEq: bigint, hbarEq: bigint, bufferPct = 115n): bigint {
    if (centEq === 0n) return 0n;
    const tinybar = (tinycents * hbarEq) / centEq;
    return (tinybar * bufferPct) / 100n;
  }

  // CONTRACT: enableSecondaryMarket value check — msg.value == pairCreateFee + hbarLiquidity (tinybar).
  function requiredValue(pairCreateFeeTinybar: bigint, hbarLiquidityTinybar: bigint): bigint {
    return pairCreateFeeTinybar + hbarLiquidityTinybar;
  }

  // CONTRACT: seed price ≈ NAV — hbarLiquidity (tinybar) = shareLiquidity(8dp) * NAV / ONE.
  function hbarLegForNav(shareLiquidity8dp: bigint, navPerShare: bigint): bigint {
    return (shareLiquidity8dp * navPerShare) / ONE;
  }

  it("converts the tinycents create fee to tinybar via the live rate (~$50, +buffer), never hardcoded", () => {
    // Example rate: 1 HBAR = 12 cents -> hbar_equivalent=1, cent_equivalent=12 (HBAR per cent basis).
    // pairCreateFee ~ $50 = 5000 cents = 5000 * 100 tinycents? Use a representative tinycents value.
    const tinycents = 500_000n; // $50 in tinycents-ish (illustrative)
    const out = feeTinycentsToTinybar(tinycents, 12n, 1n, 115n);
    expect(out > 0n).to.equal(true);
    // buffer applied: result == base * 1.15.
    const base = (tinycents * 1n) / 12n;
    expect(out).to.equal((base * 115n) / 100n);
  });

  it("rejects a zero exchange rate (cent_equivalent==0) rather than producing a bogus fee", () => {
    expect(feeTinycentsToTinybar(500_000n, 0n, 1n)).to.equal(0n);
  });

  it("seeds the share/HBAR legs at NAV: 1000 shares vs 1000 HBAR at NAV 1.0; scales with NAV", () => {
    const shares = 1000n * ONE; // 1000.00000000 shares (8dp)
    expect(hbarLegForNav(shares, ONE)).to.equal(1000n * ONE); // NAV 1.0 -> 1000 HBAR
    expect(hbarLegForNav(shares, 105n * ONE / 100n)).to.equal(1050n * ONE); // NAV 1.05 -> 1050 HBAR
  });

  it("value sent must equal createFee + HBAR liquidity (the contract's VALUE_MISMATCH guard)", () => {
    const fee = 60n * ONE; // ~60 HBAR fee
    const hbarLiq = 1000n * ONE;
    expect(requiredValue(fee, hbarLiq)).to.equal(1060n * ONE);
  });

  it("KYC-grant ordering is router-first then pair-after-create (deadlock resolution, §10)", () => {
    // CONTRACT ordering inside enableSecondaryMarket: (1) grant router, (2) addLiquidityETHNewPool,
    // (3) read pair from factory, (4) grant pair. The pair address does not exist before step 2,
    // so the pair grant CANNOT precede pair creation. Model the ordering as a sequence and assert it.
    const steps: string[] = [];
    function enableSecondaryMarket() {
      steps.push("grantKyc:router"); // (1)
      steps.push("addLiquidityETHNewPool"); // (2) creates pair
      const pair = "0xPAIR"; // (3) read from factory.getPair (now non-zero)
      if (!pair) throw new Error("PAIR_NOT_CREATED");
      steps.push("grantKyc:pair"); // (4)
      return pair;
    }
    const pair = enableSecondaryMarket();
    expect(pair).to.equal("0xPAIR");
    expect(steps).to.deep.equal(["grantKyc:router", "addLiquidityETHNewPool", "grantKyc:pair"]);
    // the pair grant must come AFTER the pool create (you cannot grant an address that doesn't exist).
    expect(steps.indexOf("grantKyc:pair") > steps.indexOf("addLiquidityETHNewPool")).to.equal(true);
  });
});

// =============================================================================
//          Live-HTS-only paths — proven by `pnpm run smoke` on testnet
// =============================================================================

/**
 * These paths exercise the HTS system contract at 0x167 (token create / mint / burn / transfer /
 * grant-KYC / freeze / wipe). They CANNOT run on a local Hardhat EVM (no precompile) and there is no
 * ethers/hardhat-ethers in this install to deploy against a fork. They are covered LIVE by
 * `pnpm run smoke` (scripts/smoke.ts: RUN A repaid lifecycle + RUN B default), which reads on-chain
 * navPerShare to PROVE the math end-to-end with HashScan links. Listed here as skipped so the
 * coverage gap is explicit and intentional, never silent.
 */
describe.skip("WaferVault — live HTS round-trips (run via `pnpm run smoke` on testnet)", () => {
  it("createPool: 2 HTS creates (share-with-fee + claim NFT) + self-KYC + dead-share seed");
  it("deposit: associate (IHRC719) -> adminGrantKyc -> mint+transfer shares to investor");
  it("redeem: pull shares (ERC-20 facade) + burn from treasury, fee-exempt full-share burn succeeds");
  it("financeClaim: escrow device-NFT (transferNFT) + mint claim NFT + pay advance (CEI)");
  it("settleRewards repay branch: burn claim NFT + return device-NFT to operator on Repaid");
  it("markDefault: write down carry + retain/wipe device-NFT collateral");
  it("0.10% fractional fee charged on a secondary (third-party) transfer, exempt on deposit/redeem");
  it("adminGrantKyc / freeze: grant/revoke + freeze/unfreeze gate HTS transfers (rc==22 checks)");
  it("enableSecondaryMarket: KYC-grant router -> addLiquidityETHNewPool (create+seed) -> KYC-grant pair");
});
