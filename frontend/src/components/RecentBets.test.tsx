import { describe, expect, it } from "vitest";
import { makeBet, makeEvent } from "@/test/fixtures";
import { render, screen } from "@/test/render";
import type { OddsEvent } from "@/types";
import { RecentBets } from "./RecentBets";

const emptyIndex = new Map<string, OddsEvent>();

describe("RecentBets", () => {
  it("caps the list at the 5 most recent bets even when more are passed", () => {
    const bets = Array.from({ length: 6 }, (_, i) =>
      makeBet({ id: `bet-${i}` }),
    );
    render(<RecentBets bets={bets} oddsIndex={emptyIndex} />);

    expect(screen.getAllByTestId(/^bet-row-/)).toHaveLength(5);
    // bets arrive newest-first, so the head slice keeps bet-0..bet-4.
    expect(screen.queryByTestId("bet-row-5")).not.toBeInTheDocument();
    expect(screen.getByTestId("view-all-bets")).toBeInTheDocument();
  });

  it("shows an empty state when there are no bets", () => {
    render(<RecentBets bets={[]} oddsIndex={emptyIndex} />);
    expect(screen.getByText("No bets yet.")).toBeInTheDocument();
    expect(screen.queryByTestId(/^bet-row-/)).not.toBeInTheDocument();
  });

  it("shows the competing team names from the joined event", () => {
    const bet = makeBet({ id: "bet-1", eventId: "mock:epl-1" });
    const oddsIndex = new Map([
      [
        "mock:epl-1",
        makeEvent({
          eventId: "mock:epl-1",
          homeTeamName: "Arsenal",
          awayTeamName: "Chelsea",
        }),
      ],
    ]);
    render(<RecentBets bets={[bet]} oddsIndex={oddsIndex} />);

    const teams = screen.getByTestId("bet-teams-bet-1");
    expect(teams).toHaveTextContent("Arsenal vs Chelsea");
  });

  it("omits the matchup line when the event is not in the index", () => {
    const bet = makeBet({ id: "bet-1", eventId: "mock:missing" });
    render(<RecentBets bets={[bet]} oddsIndex={emptyIndex} />);

    expect(screen.queryByTestId("bet-teams-bet-1")).not.toBeInTheDocument();
    // the bet still renders, just without team names
    expect(screen.getByTestId("bet-row-bet-1")).toBeInTheDocument();
  });
});
