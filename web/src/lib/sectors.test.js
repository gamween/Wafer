import { describe, it, expect } from "vitest";
import { poolTrailingApr, groupBySector } from "./sectors.js";

// 100 HBAR advance in 8-dp units; one full year term → year/term = 1.
const ADV = 100_00000000n;
const YEAR = 31_536_000n; // 365*24*60*60
const deal = (poolId, expectedHbar, status = 4) => ({
  poolId, status, advance: ADV, expected: BigInt(expectedHbar) * 1_00000000n, term: YEAR,
});

describe("poolTrailingApr", () => {
  it("returns null when a pool has no financed deals", () => {
    expect(poolTrailingApr(0, [])).toBe(null);
  });

  it("ignores non-financed deals (status not 3 or 4)", () => {
    // status 0 (Proposed) must not count.
    expect(poolTrailingApr(0, [{ ...deal(0, 110), status: 0 }])).toBe(null);
  });

  it("computes the advance-weighted APR across financed deals", () => {
    // Single deal: expected 110 vs advance 100 over a year → 0.10.
    expect(poolTrailingApr(0, [deal(0, 110)])).toBeCloseTo(0.1, 6);
  });
});

describe("groupBySector", () => {
  it("always returns one entry per category (5), even with no pools", () => {
    const sectors = groupBySector([], []);
    expect(sectors).toHaveLength(5);
    expect(sectors[0]).toMatchObject({ category: 0, label: "GPU / Compute", logo: "/logos/gpu.png" });
    expect(sectors[0].classes).toEqual([]);
    expect(sectors[0].maxApr).toBe(null);
  });

  it("groups pools by category, sorts classes A→B→C, and computes maxApr", () => {
    const pools = [
      { poolId: 2, category: 0, class: 2 }, // GPU-C
      { poolId: 0, category: 0, class: 0 }, // GPU-A
      { poolId: 1, category: 0, class: 1 }, // GPU-B
    ];
    const deals = [deal(0, 110), deal(1, 120), deal(2, 115)]; // 0.10, 0.20, 0.15
    const gpu = groupBySector(pools, deals)[0];
    expect(gpu.classes.map((c) => c.risk)).toEqual(["A", "B", "C"]);
    expect(gpu.classes.map((c) => c.poolId)).toEqual([0, 1, 2]);
    expect(gpu.maxApr).toBeCloseTo(0.2, 6);
  });

  it("keeps a class row with null apr but excludes it from maxApr", () => {
    const pools = [
      { poolId: 0, category: 3, class: 0 }, // Energy-A, financed
      { poolId: 1, category: 3, class: 1 }, // Energy-B, no deals → null apr
    ];
    const energy = groupBySector(pools, [deal(0, 110)])[3];
    expect(energy.classes).toHaveLength(2);
    expect(energy.classes[1].apr).toBe(null);
    expect(energy.maxApr).toBeCloseTo(0.1, 6);
  });
});
