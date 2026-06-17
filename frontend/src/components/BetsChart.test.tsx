import { describe, expect, it } from "vitest";
import { render, screen } from "@/test/render";
import type { PnlPoint } from "@/types";
import { BetsChart } from "./BetsChart";

describe("BetsChart", () => {
  it("shows an empty state and no chart when there are no settled bets", () => {
    render(<BetsChart series={[]} />);
    expect(screen.getByText(/No settled bets yet/)).toBeInTheDocument();
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
  });

  it("renders the ROI% series and highlights the latest cumulative value", () => {
    const series: PnlPoint[] = [
      { date: "2026-01-01", roiPct: -25 },
      { date: "2026-01-03", roiPct: 37.5 },
    ];
    render(<BetsChart series={series} />);

    expect(
      screen.getByLabelText("Cumulative ROI percentage over time"),
    ).toBeInTheDocument();
    // Latest cumulative ROI surfaced in the header.
    expect(screen.getByText("+37.5%")).toBeInTheDocument();
  });
});
