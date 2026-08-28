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

const BASE_URL = "https://api.the-odds-api.com/v4";
const DEFAULT_SPORTS = ["soccer_epl", "basketball_nba", "americanfootball_nfl"];
// `/scores` only returns finished games when `daysFrom` is set, and the API caps
// it at 3 days. A game that kicked off longer ago than that never comes back, so
// it ages out of the runner's pending window unresolved — tighter than the
// runner's own 7-day lookback, and the reason to poll well inside that.
const SCORES_DAYS_FROM = 3;
const REQUEST_TIMEOUT_MS = 10_000;

const logger = new Logger("TheOddsApiProvider");

type Raw = Record<string, unknown>;

function h2hMarket(outcomes: Raw[], home: string, away: string): Market | null {
  const selections: Selection[] = [];
  for (const o of outcomes) {
    const key = outcomeFor(String(o.name), home, away);
    if (key === null) {
      continue;
    }
    selections.push({ key, name: String(o.name), odds: Number(o.price) });
  }
  return selections.length ? { key: "h2h", selections } : null;
}

function totalsMarket(outcomes: Raw[]): Market | null {
  const selections: Selection[] = [];
  for (const o of outcomes) {
    const key = String(o.name).trim().toLowerCase();
    if (key !== "over" && key !== "under") {
      continue;
    }
    selections.push({
      key,
      name: String(o.name),
      odds: Number(o.price),
      point: o.point === null || o.point === undefined ? null : Number(o.point),
    });
  }
  return selections.length ? { key: "totals", selections } : null;
}

export function normalise(rawEvent: Raw, sport: string): CanonicalEvent | null {
  const bookmakers = (rawEvent.bookmakers as Raw[] | undefined) ?? [];
  if (!bookmakers.length) {
    return null;
  }
  const home = rawEvent.home_team;
  const away = rawEvent.away_team;
  const sourceId = rawEvent.id;
  if (
    typeof home !== "string" ||
    typeof away !== "string" ||
    typeof sourceId !== "string"
  ) {
    return null;
  }

  // Take the first bookmaker's markets as representative.
  const rawMarkets = (bookmakers[0].markets as Raw[] | undefined) ?? [];
  const markets: Market[] = [];
  for (const m of rawMarkets) {
    const outcomes = (m.outcomes as Raw[] | undefined) ?? [];
    let market: Market | null = null;
    if (m.key === "h2h") {
      market = h2hMarket(outcomes, home, away);
    } else if (m.key === "totals") {
      market = totalsMarket(outcomes);
    }
    if (market !== null) {
      markets.push(market);
    }
  }
  if (!markets.length) {
    return null;
  }

  // The Odds API's `sport_key` conflates sport and competition ("soccer_epl");
  // it stands in as the league source key, and `sport_title` ("EPL") as the
  // league name. There are no team or league ids — the resolver matches teams
  // by normalized name.
  return {
    eventId: `theoddsapi:${sourceId}`,
    origin: "theoddsapi",
    sourceEventId: sourceId,
    sport,
    homeTeam: home,
    awayTeam: away,
    markets,
    updatedAt: Date.now(),
    leagueKey: (rawEvent.sport_key as string | undefined) ?? sport,
    leagueName: (rawEvent.sport_title as string | undefined) ?? null,
  };
}

/**
 * Map a finished game's score array to our (home/away/draw) selection key.
 *
 * The Odds API reports scores per team name (`[{"name": …, "score": "113"}]`,
 * the score a *string*) and offers no winner flag, so the outcome is simply the
 * comparison. Returns null when either side is missing or unparseable — a
 * malformed payload must not settle bets.
 */
export function outcomeFromScores(
  scores: Raw[],
  home: string,
  away: string,
): Outcome | null {
  const points = new Map<Outcome, number>();
  for (const entry of scores) {
    const side = outcomeFor(String(entry.name ?? ""), home, away);
    if (side !== "home" && side !== "away") {
      continue;
    }
    const raw = entry.score;
    if (typeof raw !== "string" && typeof raw !== "number") {
      return null;
    }
    // Python's int() rejects "2.5" and "" as well as non-numeric text.
    const value = Number(raw);
    if (!Number.isInteger(value) || String(raw).trim() === "") {
      return null;
    }
    points.set(side, value);
  }
  const home_ = points.get("home");
  const away_ = points.get("away");
  if (home_ === undefined || away_ === undefined) {
    return null;
  }
  if (home_ > away_) {
    return "home";
  }
  if (away_ > home_) {
    return "away";
  }
  return "draw";
}

export function resultFor(
  rawEvent: Raw,
  pending: Map<string, CanonicalEvent>,
): EventResult | null {
  const event = pending.get(String(rawEvent.id ?? ""));
  if (event === undefined) {
    return null;
  }
  if (!rawEvent.completed) {
    return null;
  }
  // `scores` is null until kickoff; a completed game without one is malformed.
  const scores = rawEvent.scores as Raw[] | null | undefined;
  if (!scores?.length) {
    logger.warn(
      `Game ${event.sourceEventId} is completed but carries no scores — ${event.eventId} stays unresolved`,
    );
    return null;
  }
  // Match on the payload's own team names rather than our stored ones, so the
  // comparison can't be thrown off by a name the provider has since changed.
  const outcome = outcomeFromScores(
    scores,
    String(rawEvent.home_team ?? ""),
    String(rawEvent.away_team ?? ""),
  );
  if (outcome === null) {
    logger.warn(
      `Game ${event.sourceEventId} has unreadable scores — ${event.eventId} stays unresolved`,
    );
    return null;
  }
  logger.log(
    `Game ${event.sourceEventId} completed — resolving ${event.eventId} as ${outcome}`,
  );
  return {
    eventId: event.eventId,
    sport: event.sport,
    outcome,
    resolvedAt: Date.now(),
  };
}

export class TheOddsApiProvider extends OddsProvider {
  readonly name = "theoddsapi";
  readonly pollsResults = true;

  constructor(
    private readonly apiKey: string,
    private readonly sports: string[],
  ) {
    super();
  }

  static fromEnv(env: NodeJS.ProcessEnv = process.env): TheOddsApiProvider {
    const sportsEnv = env.THE_ODDS_API_SPORTS;
    return new TheOddsApiProvider(
      env.THE_ODDS_API_KEY ?? "demo",
      sportsEnv ? sportsEnv.split(",").map((s) => s.trim()) : DEFAULT_SPORTS,
    );
  }

  private async get(url: string): Promise<Response> {
    return fetch(url, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
  }

  async *fetchTick(): AsyncGenerator<CanonicalEvent> {
    for (const sport of this.sports) {
      const url =
        `${BASE_URL}/sports/${sport}/odds/` +
        `?apiKey=${this.apiKey}&regions=eu&markets=h2h,totals` +
        `&oddsFormat=decimal`;
      try {
        const resp = await this.get(url);
        if (resp.status !== 200) {
          logger.warn(`Odds API returned ${resp.status} for ${sport}`);
          continue;
        }
        const events = (await resp.json()) as Raw[];
        for (const raw of events) {
          const event = normalise(raw, sport);
          if (event) {
            yield event;
          }
        }
        logger.log(`Polled ${events.length} events for ${sport}`);
      } catch (err) {
        logger.error(`Poll failed for ${sport}: ${String(err)}`);
      }
    }
  }

  async *fetchResults(pending: CanonicalEvent[]): AsyncGenerator<EventResult> {
    // `/scores` is per-sport, so group the pending events by the sport key they
    // were ingested under and ask each sport only about its own ids.
    const bySport = new Map<string, Map<string, CanonicalEvent>>();
    for (const event of pending) {
      const wanted = bySport.get(event.sport) ?? new Map();
      wanted.set(event.sourceEventId, event);
      bySport.set(event.sport, wanted);
    }

    for (const [sport, wanted] of bySport) {
      const url =
        `${BASE_URL}/sports/${sport}/scores/` +
        `?apiKey=${this.apiKey}&daysFrom=${SCORES_DAYS_FROM}` +
        `&eventIds=${[...wanted.keys()].join(",")}`;
      try {
        const resp = await this.get(url);
        if (resp.status !== 200) {
          logger.warn(`Odds API scores returned ${resp.status} for ${sport}`);
          continue;
        }
        const rawEvents = (await resp.json()) as Raw[];
        for (const raw of rawEvents) {
          const result = resultFor(raw, wanted);
          if (result !== null) {
            yield result;
          }
        }
        logger.log(`Polled scores for ${wanted.size} pending ${sport} events`);
      } catch (err) {
        logger.error(`Scores poll failed for ${sport}: ${String(err)}`);
      }
    }
  }
}
