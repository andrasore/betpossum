import { describe, expect, it } from "vitest";
import { makeBet, makeEvent } from "@/test/fixtures";
import { render, screen, within } from "@/test/render";
import type { OddsEvent } from "@/types";
import { BetsTable } from "./BetsTable";

function indexOf(...events: OddsEvent[]): Map<string, OddsEvent> {
  return new Map(events.map((e) => [e.eventId, e]));
}

describe("BetsTable", () => {
  it("renders every bet uncapped (unlike the 5-row Recent Bets sidebar)", () => {
    const bets = Array.from({ length: 6 }, (_, i) =>
      makeBet({ id: `bet-${i}`, eventId: `mock:epl-${i}` }),
    );
    render(<BetsTable bets={bets} oddsIndex={new Map()} />);
    expect(screen.getAllByTestId(/^bet-row-/)).toHaveLength(6);
  });

  it("enriches the Teams cell from the odds join", () => {
    const event = makeEvent({
      eventId: "mock:epl-1",
      homeTeamName: "Arsenal",
      awayTeamName: "Chelsea",
      leagueName: "Premier League",
    });
    const bet = makeBet({ id: "bet-1", eventId: "mock:epl-1" });
    render(<BetsTable bets={[bet]} oddsIndex={indexOf(event)} />);

    const row = screen.getByTestId("bet-row-bet-1");
    expect(within(row).getByText("Arsenal vs Chelsea")).toBeInTheDocument();
    expect(within(row).getByText("Premier League")).toBeInTheDocument();
  });

  it("falls back to the raw eventId when the join misses", () => {
    const bet = makeBet({ id: "bet-1", eventId: "mock:epl-gone" });
    render(<BetsTable bets={[bet]} oddsIndex={new Map()} />);

    const row = screen.getByTestId("bet-row-bet-1");
    // Teams cell shows the raw id, not a "home vs away" pairing.
    expect(within(row).getByText("mock:epl-gone")).toBeInTheDocument();
    expect(within(row).queryByText(/\bvs\b/)).not.toBeInTheDocument();
  });

  it("shows an empty state when there are no bets", () => {
    render(<BetsTable bets={[]} oddsIndex={new Map()} />);
    expect(screen.getByText("No bets yet.")).toBeInTheDocument();
  });
});
