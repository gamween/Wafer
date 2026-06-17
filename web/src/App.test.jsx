import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import App from "./App.jsx";

// ---------------------------------------------------------------------------
// Wallet + contracts mocks — keep them outside vi.mock() factories so they
// can be imported in tests for assertions if needed.
// ---------------------------------------------------------------------------

vi.mock("./hooks/useWallet.js", () => ({
  useWallet: () => ({
    account: "0x00000000000000000000000000000000000000a1",
    walletClient: {},
    publicClient: {},
    connecting: false,
    connect: vi.fn(),
    disconnect: vi.fn(),
    wrongNetwork: false,
    switchNetwork: vi.fn(),
  }),
}));

const ADV = 100_00000000n;
const YEAR = 31_536_000n;

vi.mock("./hooks/useContracts.js", () => ({
  useContracts: () => ({
    configured: true,
    getPools: vi.fn().mockResolvedValue([
      { poolId: 0, category: 0, class: 0 },
      { poolId: 1, category: 0, class: 1 },
    ]),
    getDeals: vi.fn().mockResolvedValue([
      { poolId: 0, status: 4, advance: ADV, expected: 110_00000000n, term: YEAR },
      { poolId: 1, status: 4, advance: ADV, expected: 120_00000000n, term: YEAR },
    ]),
    getRoles: vi.fn().mockResolvedValue({ isOwner: false, isOperator: false }),
    getHbarBalance: vi.fn().mockResolvedValue(0n),
    // Methods called by DepositCard when it mounts on the Deposit tab.
    getShareBalance: vi.fn().mockResolvedValue(null),
    getKycStatus: vi.fn().mockResolvedValue({ associated: false, kycGranted: false }),
    getMaxRedeem: vi.fn().mockResolvedValue(0n),
    getNavPerShare: vi.fn().mockResolvedValue(1_00000000n),
  }),
}));

describe("App routing integration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("lands on Discover and shows the Discover nav item active", async () => {
    render(<App />);

    // Wait for the lazy Discover component to load and render its tagline.
    expect(await screen.findByText(/Hover a sector/i)).toBeInTheDocument();

    // The Discover nav button should be marked active.
    const discoverBtn = screen.getByRole("button", { name: /Discover/i });
    expect(discoverBtn).toHaveAttribute("aria-current", "page");
  });

  it("clicking a sector coin class row routes to Deposit (Deposit nav becomes active)", async () => {
    const user = userEvent.setup();
    render(<App />);

    // Wait for the lazy Discover component to finish loading.
    await screen.findByText(/Hover a sector/i);

    // The GPU / Compute coin (category 0, has 2 pools from the mock) should be present.
    // SectorCoin renders a button whose accessible name includes the sector label.
    const gpuCoin = await screen.findByRole("button", { name: /GPU \/ Compute/i });
    await user.click(gpuCoin);

    // The class menu should now be open (two class rows: A and B).
    const classB = await screen.findByRole("menuitem", { name: /Class B/i });
    await user.click(classB);

    // After clicking, onOpenDeposit(1) is called → setTab("deposit").
    // Assert routing by checking the Deposit button in the PRIMARY NAV is now active.
    // Use within() on the <nav aria-label="Primary"> to avoid matching DepositCard's
    // own internal "Deposit" tab button.
    const primaryNav = screen.getByRole("navigation", { name: /Primary/i });
    const depositNavBtn = within(primaryNav).getByRole("button", { name: /^Deposit$/i });
    expect(depositNavBtn).toHaveAttribute("aria-current", "page");
  });
});
