import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import SectorMark from "./SectorMark.jsx";

describe("SectorMark", () => {
  it("renders the category logo", () => {
    render(<SectorMark logo="/logos/gpu.png" alt="GPU" />);
    expect(screen.getByAltText("GPU")).toHaveAttribute("src", "/logos/gpu.png");
  });

  it("shows the risk-grade badge for A/B/C", () => {
    render(<SectorMark logo="/logos/gpu.png" grade="B" alt="GPU" />);
    expect(screen.getByText("B")).toBeInTheDocument();
  });

  it("hides the badge when grade is missing or not A/B/C", () => {
    const { rerender } = render(<SectorMark logo="/logos/gpu.png" alt="GPU" />);
    expect(screen.queryByText(/^[A-C]$/)).toBeNull();
    rerender(<SectorMark logo="/logos/gpu.png" grade="—" alt="GPU" />);
    expect(screen.queryByText(/^[A-C]$/)).toBeNull();
  });
});
