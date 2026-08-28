/**
 * Mock odds provider for local development.
 *
 * Maintains a fixed pool of fixtures across three sports and slowly drifts their
 * odds on each tick so the frontend sees realistic live-market movement without
 * calling a real API. Each fixture carries a moneyline (`h2h`) market plus an
 * over/under (`totals`) market, so the flexible common model is exercised even
 * though only `h2h` projects onto the wire contract. Mock events are the only
 * ones an admin may resolve manually.
 *
 * The fixture ids and league names are load-bearing: e2e/tests/{sport,league}-
 * filter.spec.ts assert on `mock:epl-*` / `mock:nba-*` / `mock:nfl-*` and on the
 * Premier League / NBA / NFL chips.
 */
import { Logger } from "@nestjs/common";
import type { CanonicalEvent, Market, Selection } from "../odds/models";
import { OddsProvider } from "./base";

export interface Fixture {
  eventId: string;
  sport: string;
  league: string;
  country: string;
  homeTeam: string;
  awayTeam: string;
}

export const FIXTURES: Fixture[] = [
  {
    eventId: "epl-001",
    sport: "soccer_epl",
    league: "Premier League",
    country: "England",
    homeTeam: "Arsenal",
    awayTeam: "Chelsea",
  },
  {
    eventId: "epl-002",
    sport: "soccer_epl",
    league: "Premier League",
    country: "England",
    homeTeam: "Liverpool",
    awayTeam: "Manchester City",
  },
  {
    eventId: "epl-003",
    sport: "soccer_epl",
    league: "Premier League",
    country: "England",
    homeTeam: "Tottenham",
    awayTeam: "Manchester United",
  },
  {
    eventId: "nba-001",
    sport: "basketball_nba",
    league: "NBA",
    country: "USA",
    homeTeam: "LA Lakers",
    awayTeam: "Golden State Warriors",
  },
  {
    eventId: "nba-002",
    sport: "basketball_nba",
    league: "NBA",
    country: "USA",
    homeTeam: "Boston Celtics",
    awayTeam: "Miami Heat",
  },
  {
    eventId: "nfl-001",
    sport: "americanfootball_nfl",
    league: "NFL",
    country: "USA",
    homeTeam: "Kansas City Chiefs",
    awayTeam: "San Francisco 49ers",
  },
  {
    eventId: "nfl-002",
    sport: "americanfootball_nfl",
    league: "NFL",
    country: "USA",
    homeTeam: "Dallas Cowboys",
    awayTeam: "New York Giants",
  },
];

// Minutes-from-startup kickoff offset per fixture, giving the mock board a
// spread of commence times (a couple live-soon, the rest over the coming days)
// so the frontend cards show varied dates. Anchored to provider start so the
// times are always in the near future regardless of when dev is run.
const COMMENCE_OFFSET_MINUTES: Record<string, number> = {
  "epl-001": 180,
  "epl-002": 1560,
  "epl-003": 2940,
  "nba-001": 300,
  "nba-002": 1680,
  "nfl-001": 3060,
  "nfl-002": 4440,
};
const DEFAULT_COMMENCE_OFFSET_MINUTES = 120;

/** Total-line per sport for the over/under market. */
const TOTAL_POINTS: Record<string, number> = {
  soccer_epl: 2.5,
  basketball_nba: 220.5,
  americanfootball_nfl: 47.5,
};
const DEFAULT_TOTAL_POINT = 2.5;

interface DriftState {
  home: number;
  away: number;
  draw: number;
  over: number;
  under: number;
}

function hasDraw(sport: string): boolean {
  return sport.startsWith("soccer");
}

function uniform(lo: number, hi: number): number {
  return lo + Math.random() * (hi - lo);
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function seed(withDraw: boolean): DriftState {
  return {
    home: round2(uniform(1.5, 3.5)),
    away: round2(uniform(1.5, 3.5)),
    draw: withDraw ? round2(uniform(2.8, 4.0)) : 0,
    over: round2(uniform(1.7, 2.1)),
    under: round2(uniform(1.7, 2.1)),
  };
}

function drift(value: number, lo: number, hi: number): number {
  return round2(Math.max(lo, Math.min(hi, value + uniform(-0.15, 0.15))));
}

export class MockProvider extends OddsProvider {
  readonly name = "mock";

  private readonly startedAt = Date.now();
  private readonly state = new Map<string, DriftState>();

  constructor(private readonly fixtures: Fixture[] = FIXTURES) {
    super();
  }

  private readonly logger = new Logger(MockProvider.name);

  private commenceTime(eventId: string): number {
    const offset =
      COMMENCE_OFFSET_MINUTES[eventId] ?? DEFAULT_COMMENCE_OFFSET_MINUTES;
    return this.startedAt + offset * 60_000;
  }

  private markets(sport: string, state: DriftState): Market[] {
    const h2h: Selection[] = [
      { key: "home", name: "Home", odds: state.home },
      { key: "away", name: "Away", odds: state.away },
    ];
    if (hasDraw(sport)) {
      h2h.splice(1, 0, { key: "draw", name: "Draw", odds: state.draw });
    }
    const point = TOTAL_POINTS[sport] ?? DEFAULT_TOTAL_POINT;
    return [
      { key: "h2h", selections: h2h },
      {
        key: "totals",
        selections: [
          { key: "over", name: `Over ${point}`, odds: state.over, point },
          { key: "under", name: `Under ${point}`, odds: state.under, point },
        ],
      },
    ];
  }

  async *fetchTick(): AsyncGenerator<CanonicalEvent> {
    for (const fixture of this.fixtures) {
      const sid = fixture.eventId;
      const withDraw = hasDraw(fixture.sport);

      let state = this.state.get(sid);
      if (!state) {
        state = seed(withDraw);
        this.state.set(sid, state);
      }

      state.home = drift(state.home, 1.1, 6.0);
      state.away = drift(state.away, 1.1, 6.0);
      if (withDraw) {
        state.draw = drift(state.draw, 2.5, 6.0);
      }
      state.over = drift(state.over, 1.4, 2.6);
      state.under = drift(state.under, 1.4, 2.6);

      yield {
        eventId: this.canonicalId(sid),
        origin: this.name,
        sourceEventId: sid,
        sport: fixture.sport,
        homeTeam: fixture.homeTeam,
        awayTeam: fixture.awayTeam,
        markets: this.markets(fixture.sport, state),
        updatedAt: Date.now(),
        commenceTime: this.commenceTime(sid),
        leagueKey: fixture.sport,
        leagueName: fixture.league,
        country: fixture.country,
      };
    }

    this.logger.log(`Published mock odds for ${this.fixtures.length} fixtures`);
  }
}
