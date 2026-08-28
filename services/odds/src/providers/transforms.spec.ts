/**
 * Provider payload -> common-model transforms, result mapping, and the h2h wire
 * projection.
 *
 * These exercise real boundaries: the shape each external API actually returns,
 * and the projection the wire contract depends on.
 */
import {
  type CanonicalEvent,
  h2hOdds,
  type Market,
  market,
} from "../odds/models";
import {
  ApiFootballProvider,
  marketsFromBets,
  outcomeFromFixture,
} from "./apifootball.provider";
import {
  normalise,
  outcomeFromScores,
  resultFor as scoresResultFor,
} from "./theoddsapi.provider";

const requireMarket = (event: CanonicalEvent, key: string): Market => {
  const found = market(event, key);
  if (!found) {
    throw new Error(`missing ${key} market`);
  }
  return found;
};

const oddsByKey = (m: Market): Record<string, number> =>
  Object.fromEntries(m.selections.map((s) => [s.key, s.odds]));

describe("The Odds API normalise", () => {
  it("builds h2h and totals markets", () => {
    const raw = {
      id: "abc123",
      home_team: "Arsenal",
      away_team: "Chelsea",
      bookmakers: [
        {
          markets: [
            {
              key: "h2h",
              outcomes: [
                { name: "Arsenal", price: 1.8 },
                { name: "Chelsea", price: 4.2 },
                { name: "Draw", price: 3.5 },
              ],
            },
            {
              key: "totals",
              outcomes: [
                { name: "Over", price: 1.9, point: 2.5 },
                { name: "Under", price: 1.95, point: 2.5 },
              ],
            },
          ],
        },
      ],
    };

    const event = normalise(raw, "soccer_epl");
    expect(event).not.toBeNull();
    if (!event) {
      return;
    }
    expect(event.origin).toBe("theoddsapi");
    expect(event.eventId).toBe("theoddsapi:abc123");
    expect(event.sourceEventId).toBe("abc123");

    expect(oddsByKey(requireMarket(event, "h2h"))).toEqual({
      home: 1.8,
      away: 4.2,
      draw: 3.5,
    });

    const over = requireMarket(event, "totals").selections.find(
      (s) => s.key === "over",
    );
    expect(over?.point).toBe(2.5);
  });

  it("skips a payload with no bookmakers", () => {
    expect(
      normalise({ id: "x", home_team: "A", away_team: "B" }, "s"),
    ).toBeNull();
  });
});

describe("API-Football markets", () => {
  it("maps Match Winner to h2h and Goals Over/Under to totals", () => {
    const bets = [
      {
        name: "Match Winner",
        values: [
          { value: "Home", odd: "2.10" },
          { value: "Draw", odd: "3.40" },
          { value: "Away", odd: "3.20" },
        ],
      },
      {
        name: "Goals Over/Under",
        values: [
          { value: "Over 2.5", odd: "1.85" },
          { value: "Under 2.5", odd: "1.95" },
        ],
      },
    ];

    const markets = marketsFromBets(bets, "Arsenal", "Chelsea");
    const byKey = new Map(markets.map((m) => [m.key, m]));

    expect(oddsByKey(byKey.get("h2h") as Market)).toEqual({
      home: 2.1,
      away: 3.2,
      draw: 3.4,
    });
    const under = (byKey.get("totals") as Market).selections.find(
      (s) => s.key === "under",
    );
    expect(under?.point).toBe(2.5);
  });
});

describe("h2hOdds projection", () => {
  const base = {
    origin: "mock",
    sport: "soccer_epl",
    homeTeam: "A",
    awayTeam: "B",
    updatedAt: 1,
  };

  it("projects home/away/draw in wire order", () => {
    const event: CanonicalEvent = {
      ...base,
      eventId: "mock:e1",
      sourceEventId: "e1",
      markets: [
        {
          key: "h2h",
          selections: [
            { key: "home", name: "A", odds: 1.5 },
            { key: "draw", name: "Draw", odds: 3.0 },
            { key: "away", name: "B", odds: 2.0 },
          ],
        },
      ],
    };
    expect(h2hOdds(event)).toEqual([1.5, 2.0, 3.0]);
  });

  it("is null without an h2h market", () => {
    const event: CanonicalEvent = {
      ...base,
      eventId: "mock:e2",
      sourceEventId: "e2",
      sport: "basketball_nba",
      markets: [
        {
          key: "totals",
          selections: [{ key: "over", name: "Over", odds: 1.9, point: 210.5 }],
        },
      ],
    };
    expect(h2hOdds(event)).toBeNull();
  });
});

// ── API-Football result mapping ──────────────────────────────────────────────
//
// Payload shapes copied from live `/fixtures?ids=` responses. `score.fulltime`
// is carried even though the mapping keys off the winner flags, so the PEN case
// documents which of the two the settlement follows.

const fixture = (
  status: string,
  {
    homeWinner,
    awayWinner,
    fulltime = [0, 0],
    penalty = null,
    fixtureId = 1492300,
  }: {
    homeWinner: unknown;
    awayWinner: unknown;
    fulltime?: [number, number];
    penalty?: [number, number] | null;
    fixtureId?: number;
  },
) => ({
  fixture: { id: fixtureId, status: { short: status } },
  teams: {
    home: { name: "Atletico Paranaense", winner: homeWinner },
    away: { name: "Internacional", winner: awayWinner },
  },
  goals: { home: fulltime[0], away: fulltime[1] },
  score: {
    fulltime: { home: fulltime[0], away: fulltime[1] },
    penalty:
      penalty !== null
        ? { home: penalty[0], away: penalty[1] }
        : { home: null, away: null },
  },
});

const pendingEvent = (sourceId = "1492300"): CanonicalEvent => ({
  eventId: `apifootball:${sourceId}`,
  origin: "apifootball",
  sourceEventId: sourceId,
  sport: "soccer_71",
  homeTeam: "Atletico Paranaense",
  awayTeam: "Internacional",
  markets: [],
  updatedAt: 1,
});

const provider = () => new ApiFootballProvider("k", ["71"], "2026", 3);

const pendingMap = () => new Map([["1492300", pendingEvent()]]);

describe("API-Football result mapping", () => {
  it.each([
    [true, false, "home"],
    [false, true, "away"],
    // A 90-minute draw comes back with a null winner on *both* sides.
    [null, null, "draw"],
  ])("reads winner flags %p/%p as %s", (homeWinner, awayWinner, expected) => {
    expect(outcomeFromFixture(fixture("FT", { homeWinner, awayWinner }))).toBe(
      expected,
    );
  });

  it("is null when the winner flags are absent", () => {
    // A malformed payload must not settle bets as a draw.
    expect(outcomeFromFixture({ teams: { home: {}, away: {} } })).toBeNull();
    expect(outcomeFromFixture({})).toBeNull();
  });

  it("carries the canonical id and sport for a finished fixture", () => {
    const result = provider().resultFor(
      fixture("FT", { homeWinner: true, awayWinner: false, fulltime: [2, 0] }),
      pendingMap(),
    );

    expect(result).not.toBeNull();
    expect(result?.eventId).toBe("apifootball:1492300");
    expect(result?.sport).toBe("soccer_71");
    expect(result?.outcome).toBe("home");
    expect(result?.resolvedAt).toBeGreaterThan(0);
  });

  it("follows the advancing team on penalties", () => {
    // MLS playoff shape: level at 90, decided 6-7 on penalties. We settle on
    // the winner flag, so this is `away` rather than the regulation-time `draw`.
    const result = provider().resultFor(
      fixture("PEN", {
        homeWinner: false,
        awayWinner: true,
        fulltime: [0, 0],
        penalty: [6, 7],
      }),
      pendingMap(),
    );

    expect(result?.outcome).toBe("away");
  });

  it.each(["NS", "1H", "HT", "2H", "SUSP"])(
    "is null for an unfinished fixture (%s)",
    (status) => {
      expect(
        provider().resultFor(
          fixture(status, { homeWinner: null, awayWinner: null }),
          pendingMap(),
        ),
      ).toBeNull();
    },
  );

  it.each(["PST", "CANC", "ABD"])(
    "is null for an abandoned fixture (%s)",
    (status) => {
      // No fair 1X2 outcome — the bet stays held rather than being guessed at.
      expect(
        provider().resultFor(
          fixture(status, { homeWinner: null, awayWinner: null }),
          pendingMap(),
        ),
      ).toBeNull();
    },
  );

  it("is null for a fixture we never asked about", () => {
    // The batch only asks for pending ids, but never trust the echo.
    expect(
      provider().resultFor(
        fixture("FT", {
          homeWinner: true,
          awayWinner: false,
          fixtureId: 999,
        }),
        pendingMap(),
      ),
    ).toBeNull();
  });
});

// ── The Odds API result mapping ──────────────────────────────────────────────
//
// `/scores` shape per the v4 docs: `completed` flags the finish, `scores` is
// null before kickoff, and each entry's `score` is a *string*. There is no
// winner flag, so the outcome is the comparison.

const scorePayload = ({
  completed = true,
  scores = null,
  eventId = "abc123",
}: {
  completed?: boolean;
  scores?: Record<string, unknown>[] | null;
  eventId?: string;
} = {}) => ({
  id: eventId,
  sport_key: "soccer_epl",
  sport_title: "EPL",
  commence_time: "2026-07-25T21:30:00Z",
  completed,
  home_team: "Arsenal",
  away_team: "Chelsea",
  scores,
  last_update: "2026-07-25T23:20:00Z",
});

const scores = (home: unknown, away: unknown) => [
  { name: "Arsenal", score: home },
  { name: "Chelsea", score: away },
];

const scoresPending = (sourceId = "abc123") =>
  new Map<string, CanonicalEvent>([
    [
      sourceId,
      {
        eventId: `theoddsapi:${sourceId}`,
        origin: "theoddsapi",
        sourceEventId: sourceId,
        sport: "soccer_epl",
        homeTeam: "Arsenal",
        awayTeam: "Chelsea",
        markets: [],
        updatedAt: 1,
      },
    ],
  ]);

describe("The Odds API result mapping", () => {
  it.each([
    ["2", "1", "home"],
    ["0", "3", "away"],
    ["1", "1", "draw"],
  ])("compares string scores %s-%s as %s", (home, away, expected) => {
    expect(outcomeFromScores(scores(home, away), "Arsenal", "Chelsea")).toBe(
      expected,
    );
  });

  it("is null when a side is missing", () => {
    expect(
      outcomeFromScores(
        [{ name: "Arsenal", score: "2" }],
        "Arsenal",
        "Chelsea",
      ),
    ).toBeNull();
    // Names that match neither team leave both sides unset.
    expect(outcomeFromScores(scores("2", "1"), "Spurs", "Fulham")).toBeNull();
  });

  it("is null when a score is unparseable", () => {
    expect(
      outcomeFromScores(scores("2", "not-a-number"), "Arsenal", "Chelsea"),
    ).toBeNull();
    expect(
      outcomeFromScores(scores("2", null), "Arsenal", "Chelsea"),
    ).toBeNull();
  });

  it("resolves a completed game", () => {
    const result = scoresResultFor(
      scorePayload({ scores: scores("2", "1") }),
      scoresPending(),
    );

    expect(result?.eventId).toBe("theoddsapi:abc123");
    expect(result?.sport).toBe("soccer_epl");
    expect(result?.outcome).toBe("home");
    expect(result?.resolvedAt).toBeGreaterThan(0);
  });

  it("is null for an unfinished game", () => {
    // Before kickoff The Odds API sends completed=false and a null scores array.
    expect(
      scoresResultFor(
        scorePayload({ completed: false, scores: null }),
        scoresPending(),
      ),
    ).toBeNull();
    // In play: scores present, but not final.
    expect(
      scoresResultFor(
        scorePayload({ completed: false, scores: scores("1", "0") }),
        scoresPending(),
      ),
    ).toBeNull();
  });

  it("is null when a completed game carries no scores", () => {
    expect(
      scoresResultFor(
        scorePayload({ completed: true, scores: null }),
        scoresPending(),
      ),
    ).toBeNull();
  });

  it("is null for a game we never asked about", () => {
    expect(
      scoresResultFor(
        scorePayload({ scores: scores("2", "1"), eventId: "other" }),
        scoresPending(),
      ),
    ).toBeNull();
  });
});
