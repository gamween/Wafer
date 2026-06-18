import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import SectorCoins from "./SectorCoins.jsx";

const sectors = [
  { category: 0, label: "GPU / Compute", logo: "/logos/gpu.png", classes: [{ risk: "A", poolId: 0, apr: 0.1 }], maxApr: 0.1 },
  { category: 1, label: "Wireless", logo: "/logos/wireless.png", classes: [], maxApr: null },
];

describe("SectorCoins", () => {
  it("renders one coin button per sector", () => {
    render(<SectorCoins sectors={sectors} onOpenDeposit={() => {}} />);
    expect(screen.getAllByRole("button")).toHaveLength(2);
    expect(screen.getByText("GPU / Compute")).toBeInTheDocument();
    expect(screen.getByText("Wireless")).toBeInTheDocument();
  });
});
