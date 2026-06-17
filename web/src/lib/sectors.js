// Pure sector/APR derivation — the single source of truth for "pools grouped by
// DePIN category, with per-risk-class and max APR". Consumed by both Discover
// (floating coins) and Explore (blended-APR KPI / table). No React, no I/O.
import { CATEGORIES, CATEGORY_LABEL, CATEGORY_LOGO, RISK_CLASSES } from "./config.js";
import { dealApr } from "./format.js";

// Advance-weighted trailing APR for one pool, over its financed deals
// (DealStatus 3 = Financed, 4 = Repaid). Returns a ratio (0.11 = 11%) or null.
export function poolTrailingApr(poolId, deals) {
  const financed = deals.filter((d) => d.poolId === poolId && (d.status === 3 || d.status === 4));
  let wSum = 0, num = 0;
  for (const d of financed) {
    const apr = dealApr(d.advance, d.expected, d.term);
    if (apr == null) continue;
    const w = Number(d.advance);
    wSum += w;
    num += apr * w;
  }
  return wSum > 0 ? num / wSum : null;
}

// Group pools into the five fixed categories. Always returns 5 entries (a sector
// with no pools still gets a coin). Classes are sorted A→B→C; maxApr is the max of
// the non-null class APRs (null when none are known).
export function groupBySector(pools, deals) {
  return CATEGORIES.map((_, category) => {
    const classes = pools
      .filter((p) => p.category === category)
      .map((p) => ({
        risk: RISK_CLASSES[p.class] ?? String(p.class),
        poolId: p.poolId,
        apr: poolTrailingApr(p.poolId, deals),
      }))
      .sort((a, b) => RISK_CLASSES.indexOf(a.risk) - RISK_CLASSES.indexOf(b.risk));

    const knownAprs = classes.map((c) => c.apr).filter((a) => a != null);
    return {
      category,
      label: CATEGORY_LABEL[category] ?? `CAT${category}`,
      logo: CATEGORY_LOGO[category] ?? "/logos/hedera.svg",
      classes,
      maxApr: knownAprs.length ? Math.max(...knownAprs) : null,
    };
  });
}
