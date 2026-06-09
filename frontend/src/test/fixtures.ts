import type { Bet, OddsEvent } from "@/types";

// Minimal valid fixtures for component tests. Override only the fields a test
// cares about; everything else gets a sensible default.

export function makeEvent(overrides: Partial<OddsEvent> = {}): OddsEvent {
  return {
    eventId: "mock:epl-1",
    sport: "soccer",
    homeTeam: "home-raw",
    awayTeam: "away-raw",
    homeOdds: 2.0,
    awayOdds: 3.5,
    drawOdds: 3.0,
    updatedAt: 1_700_000_000_000,
    origin: "mock",
    ...overrides,
  };
}

export function makeBet(overrides: Partial<Bet> = {}): Bet {
  return {
    id: "bet-1",
    eventId: "mock:epl-1",
    selection: "home",
    odds: 2.0,
    stake: 10,
    payout: null,
    status: "held",
    placedAt: "2026-06-09T00:00:00.000Z",
    ...overrides,
  };
}
