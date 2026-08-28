/**
 * API-Football (api-sports.io v3) provider.
 *
 * Demonstrates the flexible common model against a real API with rich bet types.
 * Team names + kickoff come from the `/fixtures` endpoint and odds from `/odds`;
 * the two are joined on the fixture id. The "Match Winner" bet maps to our `h2h`
 * market (and so projects onto the wire contract); "Goals Over/Under" maps to a
 * `totals` market that is stored but not emitted.
 *
 * Results are discovered by polling `/fixtures` for the events the runner reports
 * as still open (`fetchResults`), so a concluded fixture settles without admin
 * action. Manual resolution stays restricted to the mock provider.
 */
import { Logger } from "@nestjs/common";
import type {
  CanonicalEvent,
  EventResult,
  Market,
  Outcome,
  Selection,
} from "../odds/models";
import { OddsProvider } from "./base";
import { outcomeFor } from "./common";

const BASE_URL = "https://v3.football.api-sports.io";
const MATCH_WINNER = "Match Winner";
const GOALS_OVER_UNDER = "Goals Over/Under";

// Fixture `status.short` codes that mean the match is over and has a winner (or
// a draw): full time, after extra time, after penalties.
const FINAL_STATUSES = new Set(["FT", "AET", "PEN"]);
// ...and the ones that end a fixture with no fair 1X2 outcome. Bets on these
// stay held: guessing an outcome would settle real money on a match that never
// produced one, and the market has no void/refund concept.
const NO_RESULT_STATUSES = new Set(["PST", "CANC", "ABD", "AWD", "WO"]);
// `/fixtures?ids=` accepts at most 20 dash-joined ids per request.
const IDS_PER_REQUEST = 20;
const REQUEST_TIMEOUT_MS = 10_000;

const logger = new Logger("ApiFootballProvider");

type Raw = Record<string, unknown>;

function totalsSelection(value: string, odd: string): Selection | null {
  // value looks like "Over 2.5" / "Under 2.5"
  const parts = value.split(/\s+/).filter(Boolean);
  if (parts.length !== 2) {
    return null;
  }
  const side = parts[0].trim().toLowerCase();
  if (side !== "over" && side !== "under") {
    return null;
  }
  const point = Number(parts[1]);
  if (Number.isNaN(point)) {
    return null;
  }
  return { key: side, name: value, odds: Number(odd), point };
}

export function marketsFromBets(
  bets: Raw[],
  home: string,
  away: string,
): Market[] {
  const markets: Market[] = [];
  for (const bet of bets) {
    const name = bet.name;
    const values = (bet.values as Raw[] | undefined) ?? [];
    if (name === MATCH_WINNER) {
      const selections: Selection[] = [];
      for (const v of values) {
        const key = outcomeFor(String(v.value), home, away);
        if (key === null) {
          continue;
        }
        selections.push({
          key,
          name: String(v.value),
          odds: Number(v.odd),
        });
      }
      if (selections.length) {
        markets.push({ key: "h2h", selections });
      }
    } else if (name === GOALS_OVER_UNDER) {
      const totals = values
        .map((v) => totalsSelection(String(v.value), String(v.odd)))
        .filter((s): s is Selection => s !== null);
      if (totals.length) {
        markets.push({ key: "totals", selections: totals });
      }
    }
  }
  return markets;
}

/**
 * Map a concluded fixture to our (home/away/draw) selection key.
 *
 * Keyed on API-Football's own winner flags: true/false for a decided match, and
 * null on *both* sides for a draw. Returns null when the flags are absent
 * altogether — a malformed payload must not settle bets as a draw.
 *
 * For AET/PEN fixtures the flag names whoever advanced, so a match level at 90
 * minutes and won on penalties resolves as home/away rather than draw. That is a
 * deliberate divergence from the regulation-time 1X2 convention the ingested
 * "Match Winner" prices are quoted against.
 */
export function outcomeFromFixture(fixture: Raw): Outcome | null {
  const teams = (fixture.teams as Raw | undefined) ?? {};
  const home = (teams.home as Raw | null) ?? {};
  const away = (teams.away as Raw | null) ?? {};
  if (!("winner" in home) || !("winner" in away)) {
    return null;
  }
  if (home.winner === true) {
    return "home";
  }
  if (away.winner === true) {
    return "away";
  }
  return "draw";
}

export class ApiFootballProvider extends OddsProvider {
  readonly name = "apifootball";
  readonly pollsResults = true;

  constructor(
    private readonly apiKey: string,
    private readonly leagues: string[],
    private readonly season: string,
    private readonly upcoming: number,
  ) {
    super();
  }

  static fromEnv(env: NodeJS.ProcessEnv = process.env): ApiFootballProvider {
    const apiKey = env.APIFOOTBALL_API_KEY;
    if (!apiKey) {
      throw new Error(
        "APIFOOTBALL_API_KEY is required when 'apifootball' is enabled",
      );
    }
    const leagues = (env.APIFOOTBALL_LEAGUES ?? "39") // 39 = EPL
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    return new ApiFootballProvider(
      apiKey,
      leagues,
      env.APIFOOTBALL_SEASON ?? "2023",
      Number(env.APIFOOTBALL_UPCOMING ?? "5"),
    );
  }

  private async get(
    path: string,
    params: Record<string, string>,
  ): Promise<Raw[]> {
    const url = `${BASE_URL}${path}?${new URLSearchParams(params)}`;
    const resp = await fetch(url, {
      headers: { "x-apisports-key": this.apiKey },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (resp.status !== 200) {
      logger.warn(`API-Football ${path} returned ${resp.status}`);
      return [];
    }
    const body = (await resp.json()) as Raw;
    return (body.response as Raw[] | undefined) ?? [];
  }

  async *fetchTick(): AsyncGenerator<CanonicalEvent> {
    for (const league of this.leagues) {
      const sport = `soccer_${league}`;
      const fixtures = await this.get("/fixtures", {
        league,
        season: this.season,
        next: String(this.upcoming),
      });
      for (const fx of fixtures) {
        const event = await this.fetchFixtureOdds(fx, sport);
        if (event !== null) {
          yield event;
        }
      }
      logger.log(`Polled ${fixtures.length} fixtures for league ${league}`);
    }
  }

  async *fetchResults(pending: CanonicalEvent[]): AsyncGenerator<EventResult> {
    const bySourceId = new Map(pending.map((e) => [e.sourceEventId, e]));
    const ids = [...bySourceId.keys()];
    for (let start = 0; start < ids.length; start += IDS_PER_REQUEST) {
      const batch = ids.slice(start, start + IDS_PER_REQUEST);
      const fixtures = await this.get("/fixtures", { ids: batch.join("-") });
      for (const fx of fixtures) {
        const result = this.resultFor(fx, bySourceId);
        if (result !== null) {
          yield result;
        }
      }
    }
  }

  resultFor(
    fixture: Raw,
    pending: Map<string, CanonicalEvent>,
  ): EventResult | null {
    const meta = (fixture.fixture as Raw | undefined) ?? {};
    const sourceId = String(meta.id ?? "");
    const event = pending.get(sourceId);
    if (event === undefined) {
      return null;
    }
    const status = String((meta.status as Raw | undefined)?.short ?? "");
    if (NO_RESULT_STATUSES.has(status)) {
      logger.log(
        `Fixture ${sourceId} ended ${status} with no 1X2 outcome — ${event.eventId} stays unresolved`,
      );
      return null;
    }
    if (!FINAL_STATUSES.has(status)) {
      return null;
    }
    const outcome = outcomeFromFixture(fixture);
    if (outcome === null) {
      logger.warn(
        `Fixture ${sourceId} is ${status} but carries no winner flags — ${event.eventId} stays unresolved`,
      );
      return null;
    }
    logger.log(
      `Fixture ${sourceId} finished (${status}) — resolving ${event.eventId} as ${outcome}`,
    );
    return {
      eventId: event.eventId,
      sport: event.sport,
      outcome,
      resolvedAt: Date.now(),
    };
  }

  private async fetchFixtureOdds(
    fixture: Raw,
    sport: string,
  ): Promise<CanonicalEvent | null> {
    const meta = fixture.fixture as Raw | undefined;
    const teams = fixture.teams as Raw | undefined;
    const homeTeam = teams?.home as Raw | undefined;
    const awayTeam = teams?.away as Raw | undefined;
    const fixtureId = meta?.id;
    const home = homeTeam?.name;
    const away = awayTeam?.name;
    if (
      fixtureId === undefined ||
      typeof home !== "string" ||
      typeof away !== "string"
    ) {
      return null;
    }
    const ts = meta?.timestamp;
    const commenceTime =
      ts === null || ts === undefined ? null : Number(ts) * 1000;

    // API-Football carries stable numeric league/team ids and the league's
    // country in the fixture payload — feed them to the entity resolver.
    const league = (fixture.league as Raw | undefined) ?? {};
    const leagueId = league.id;
    const homeId = homeTeam?.id;
    const awayId = awayTeam?.id;

    const odds = await this.get("/odds", { fixture: String(fixtureId) });
    if (!odds.length) {
      return null;
    }
    const bookmakers = (odds[0].bookmakers as Raw[] | undefined) ?? [];
    if (!bookmakers.length) {
      return null;
    }
    const markets = marketsFromBets(
      (bookmakers[0].bets as Raw[] | undefined) ?? [],
      home,
      away,
    );
    if (!markets.length) {
      return null;
    }

    return {
      eventId: this.canonicalId(String(fixtureId)),
      origin: this.name,
      sourceEventId: String(fixtureId),
      sport,
      homeTeam: home,
      awayTeam: away,
      commenceTime,
      markets,
      updatedAt: Date.now(),
      sportGroup: "soccer", // API-Football is the soccer product
      leagueKey:
        leagueId === undefined || leagueId === null ? null : String(leagueId),
      leagueName: (league.name as string | undefined) ?? null,
      country: (league.country as string | undefined) ?? null,
      homeTeamKey:
        homeId === undefined || homeId === null ? null : String(homeId),
      awayTeamKey:
        awayId === undefined || awayId === null ? null : String(awayId),
    };
  }
}
