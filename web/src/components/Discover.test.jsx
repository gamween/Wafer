import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import Discover from "./Discover.jsx";

const ADV = 100_00000000n;
const YEAR = 31_536_000n;
const mockContracts = {
  getPools: vi.fn().mockResolvedValue([
    { poolId: 0, category: 0, class: 0 },
    { poolId: 1, category: 0, class: 1 },
  ]),
  getDeals: vi.fn().mockResolvedValue([
    { poolId: 0, status: 4, advance: ADV, expected: 110_00000000n, term: YEAR }, // 0.10
    { poolId: 1, status: 4, advance: ADV, expected: 120_00000000n, term: YEAR }, // 0.20
  ]),
};

describe("Discover", () => {
  it("renders all five sector coins", () => {
    render(<Discover contracts={mockContracts} onOpenDeposit={() => {}} />);
    // groupBySector always yields 5 sectors, so 5 coins render before data resolves.
    expect(screen.getAllByRole("button")).toHaveLength(5);
  });

  it("shows the fetched max APR for a sector after load", async () => {
    render(<Discover contracts={mockContracts} onOpenDeposit={() => {}} />);
    expect(await screen.findByText("max 20.00%")).toBeInTheDocument();
  });
});
