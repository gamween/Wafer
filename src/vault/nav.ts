import type { Claim, NavSnapshot } from "./types.js";

const SCALE = 1_000_000n; // 6 dp fixed-point, matches USDC + share decimals

/**
 * Amortized-cost carrying value of a claim (SPEC.md §5).
 * Accretes linearly from `advance` toward `expected` over the term; rewards already received
 * are subtracted so cash and receivable aren't double-counted. Defaulted -> recovered value.
 */
export function carryingValue(claim: Claim, nowSec: number): bigint {
  if (claim.status === "defaulted") {
    // simple MVP recovery model: keep whatever was already swept in
    return claim.rewardsReceived;
  }
  const elapsed = Math.max(0, nowSec - claim.financedAt);
  const termSec = claim.termDays * 86_400;
  const fracMilli = termSec === 0 ? 1000n : BigInt(Math.min(1000, Math.floor((elapsed / termSec) * 1000)));
  const accreted = claim.advance + ((claim.expected - claim.advance) * fracMilli) / 1000n;
  const receivableRemaining = accreted > claim.rewardsReceived ? accreted - claim.rewardsReceived : 0n;
  return receivableRemaining;
}

/**
 * NAV per share = totalPoolValue / sharesOutstanding, with totalPoolValue = idle USDC in the
 * vault attributable to this pool + Σ carrying value of outstanding claims.
 * Genesis (0 shares) -> NAV defined as 1.0 so the first deposit mints 1 share per USDC.
 */
export function computeNav(args: {
  poolId: string;
  idleUsdc: bigint; // micro-USDC held by the vault for this pool
  claims: Claim[];
  sharesOutstanding: bigint; // micro-shares
  nowSec: number;
}): NavSnapshot {
  const active = args.claims.filter((c) => c.status !== "settled");
  const claimsValue = active.reduce((sum, c) => sum + carryingValue(c, args.nowSec), 0n);
  const totalPoolValue = args.idleUsdc + claimsValue;

  const navFixed =
    args.sharesOutstanding === 0n ? SCALE : (totalPoolValue * SCALE) / args.sharesOutstanding;

  return {
    poolId: args.poolId,
    navPerShare: Number(navFixed) / Number(SCALE),
    totalPoolValue,
    sharesOutstanding: args.sharesOutstanding,
    activeClaims: active.length,
    ts: args.nowSec,
  };
}

/** Shares to mint for a USDC deposit at the current NAV (micro-units in, micro-units out). */
export function sharesForDeposit(usdcAmount: bigint, nav: NavSnapshot): bigint {
  const navFixed = BigInt(Math.round(nav.navPerShare * Number(SCALE)));
  return (usdcAmount * SCALE) / navFixed;
}

/** USDC owed for redeeming shares at the current NAV. */
export function usdcForRedeem(shareAmount: bigint, nav: NavSnapshot): bigint {
  const navFixed = BigInt(Math.round(nav.navPerShare * Number(SCALE)));
  return (shareAmount * navFixed) / SCALE;
}
