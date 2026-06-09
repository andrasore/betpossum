import { describe, expect, it } from "vitest";
import { makeBet, makeEvent } from "@/test/fixtures";
import { betOutcomeLabel, selectionLabel } from "./betDisplay";

describe("selectionLabel", () => {
  it("falls back to the raw selection word when the event is unknown", () => {
    expect(selectionLabel(makeBet({ selection: "home" }), undefined)).toBe(
      "home",
    );
  });

  it("prefers the canonical team name, then the raw team", () => {
    const event = makeEvent({ homeTeam: "raw-home", homeTeamName: "Arsenal" });
    expect(selectionLabel(makeBet({ selection: "home" }), event)).toBe(
      "Arsenal",
    );
    expect(
      selectionLabel(
        makeBet({ selection: "away" }),
        makeEvent({ awayTeam: "raw-away", awayTeamName: undefined }),
      ),
    ).toBe("raw-away");
  });

  it("labels a draw as 'Draw' regardless of teams", () => {
    expect(selectionLabel(makeBet({ selection: "draw" }), makeEvent())).toBe(
      "Draw",
    );
  });
});

describe("betOutcomeLabel", () => {
  it("shows the won payout with profit formatting", () => {
    expect(betOutcomeLabel(makeBet({ status: "won", payout: 23.5 }))).toBe(
      "Won +£23.50",
    );
  });

  it("falls back to the bare status when there is no payout", () => {
    expect(betOutcomeLabel(makeBet({ status: "won", payout: null }))).toBe(
      "won",
    );
    expect(betOutcomeLabel(makeBet({ status: "held" }))).toBe("held");
  });
});
