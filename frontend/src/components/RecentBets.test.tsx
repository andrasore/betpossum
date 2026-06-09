import { describe, expect, it } from "vitest";
import { makeBet } from "@/test/fixtures";
import { render, screen } from "@/test/render";
import { RecentBets } from "./RecentBets";

describe("RecentBets", () => {
  it("caps the list at the 5 most recent bets even when more are passed", () => {
    const bets = Array.from({ length: 6 }, (_, i) =>
      makeBet({ id: `bet-${i}` }),
    );
    render(<RecentBets bets={bets} />);

    expect(screen.getAllByTestId(/^bet-row-/)).toHaveLength(5);
    // bets arrive newest-first, so the head slice keeps bet-0..bet-4.
    expect(screen.queryByTestId("bet-row-5")).not.toBeInTheDocument();
    expect(screen.getByTestId("view-all-bets")).toBeInTheDocument();
  });

  it("shows an empty state when there are no bets", () => {
    render(<RecentBets bets={[]} />);
    expect(screen.getByText("No bets yet.")).toBeInTheDocument();
    expect(screen.queryByTestId(/^bet-row-/)).not.toBeInTheDocument();
  });
});
