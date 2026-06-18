// Deterministic orbit placement for N coins, as percentage offsets inside the hero
// box. Coin 0 starts at top-center, going clockwise. Layout is derived from the
// count, so adding a sector rebalances the ring automatically.
export function orbitPositions(count, radius = 34) {
  if (count <= 0) return [];
  return Array.from({ length: count }, (_, i) => {
    const angle = (-90 + (360 / count) * i) * (Math.PI / 180);
    return {
      x: 50 + radius * Math.cos(angle),
      y: 50 + radius * Math.sin(angle),
    };
  });
}
