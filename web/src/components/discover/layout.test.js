import { describe, it, expect } from "vitest";
import { orbitPositions } from "./layout.js";

describe("orbitPositions", () => {
  it("returns one position per coin", () => {
    expect(orbitPositions(5)).toHaveLength(5);
    expect(orbitPositions(0)).toEqual([]);
  });

  it("places the first coin at top-center of the box", () => {
    const [first] = orbitPositions(5, 34);
    expect(first.x).toBeCloseTo(50, 5);
    expect(first.y).toBeCloseTo(16, 5); // 50 - radius
  });
});
