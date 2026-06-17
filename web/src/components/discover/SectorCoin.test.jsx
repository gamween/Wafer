import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import SectorCoin from "./SectorCoin.jsx";

const sector = {
  category: 0,
  label: "GPU / Compute",
  logo: "/logos/gpu.png",
  classes: [
    { risk: "A", poolId: 0, apr: 0.1 },
    { risk: "B", poolId: 1, apr: 0.2 },
    { risk: "C", poolId: 2, apr: 0.15 },
  ],
  maxApr: 0.2,
};

describe("SectorCoin", () => {
  it("shows the label and max APR capsule", () => {
    render(<SectorCoin sector={sector} onOpenDeposit={() => {}} />);
    expect(screen.getByText("GPU / Compute")).toBeInTheDocument();
    expect(screen.getByText("max 20.00%")).toBeInTheDocument();
  });

  it("opens a 3-class menu on click", async () => {
    const user = userEvent.setup();
    render(<SectorCoin sector={sector} onOpenDeposit={() => {}} />);
    await user.click(screen.getByRole("button", { name: /GPU \/ Compute/ }));
    expect(screen.getAllByRole("menuitem")).toHaveLength(3);
    expect(screen.getByRole("menuitem", { name: /Class B/ })).toHaveTextContent("20.00%");
  });

  it("routes the clicked class into Deposit and closes", async () => {
    const user = userEvent.setup();
    const onOpenDeposit = vi.fn();
    render(<SectorCoin sector={sector} onOpenDeposit={onOpenDeposit} />);
    await user.click(screen.getByRole("button", { name: /GPU \/ Compute/ }));
    await user.click(screen.getByRole("menuitem", { name: /Class B/ }));
    expect(onOpenDeposit).toHaveBeenCalledWith(1);
  });

  it("is disabled and shows — when the sector has no pools", () => {
    const empty = { ...sector, classes: [], maxApr: null };
    render(<SectorCoin sector={empty} onOpenDeposit={() => {}} />);
    expect(screen.getByRole("button", { name: /GPU \/ Compute/ })).toBeDisabled();
    expect(screen.getByText("—")).toBeInTheDocument();
  });

  // ---- keyboard a11y tests ----

  it("focuses the first menuitem when the menu opens", async () => {
    const user = userEvent.setup();
    render(<SectorCoin sector={sector} onOpenDeposit={() => {}} />);
    await user.click(screen.getByRole("button", { name: /GPU \/ Compute/ }));
    const [firstItem] = screen.getAllByRole("menuitem");
    expect(firstItem).toHaveFocus();
  });

  it("ArrowDown moves focus to the second menuitem", async () => {
    const user = userEvent.setup();
    render(<SectorCoin sector={sector} onOpenDeposit={() => {}} />);
    await user.click(screen.getByRole("button", { name: /GPU \/ Compute/ }));
    await user.keyboard("{ArrowDown}");
    const items = screen.getAllByRole("menuitem");
    expect(items[1]).toHaveFocus();
  });

  it("Escape closes the menu and returns focus to the trigger button", async () => {
    const user = userEvent.setup();
    render(<SectorCoin sector={sector} onOpenDeposit={() => {}} />);
    const triggerButton = screen.getByRole("button", { name: /GPU \/ Compute/ });
    await user.click(triggerButton);
    expect(screen.getAllByRole("menuitem")).toHaveLength(3);
    await user.keyboard("{Escape}");
    // Wait for AnimatePresence exit animation to unmount the menu
    await waitFor(() =>
      expect(screen.queryAllByRole("menuitem")).toHaveLength(0)
    );
    expect(triggerButton).toHaveFocus();
  });
});
