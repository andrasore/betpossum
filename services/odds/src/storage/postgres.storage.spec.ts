/**
 * PostgresStorage against a real Postgres: JSONB round-trips, upsert vs the
 * history append, ordering/filtering, the defensive result upsert, and the
 * entity resolution that merges two providers onto one canonical league/team.
 *
 * These exercise the actual SQL boundary — the kind of thing a mocked store
 * can't catch (a JSONB serialisation slip, an ON CONFLICT clause that clobbers
 * the wrong columns, the RETURNING-id round-trip, the unique (sport, match_key)
 * index actually doing the merge).
 */
import {
  PostgreSqlContainer,
  type StartedPostgreSqlContainer,
} from "@testcontainers/postgresql";
import { DataSource } from "typeorm";
import { type CanonicalEvent, type Market, market } from "../odds/models";
import { ODDS_ENTITIES } from "./entities";
import { PostgresStorage } from "./postgres.storage";

jest.setTimeout(180_000);

let container: StartedPostgreSqlContainer;
let dataSource: DataSource;
let storage: PostgresStorage;

beforeAll(async () => {
  container = await new PostgreSqlContainer("postgres:16-alpine").start();
  dataSource = new DataSource({
    type: "postgres",
    url: container.getConnectionUri(),
    entities: ODDS_ENTITIES,
    synchronize: true,
  });
  await dataSource.initialize();
  storage = new PostgresStorage(dataSource);
});

afterAll(async () => {
  await dataSource?.destroy();
  await container?.stop();
});

beforeEach(async () => {
  // A pristine schema per test; TRUNCATE ... CASCADE also resets the sequences
  // so league/team ids stay predictable.
  await dataSource.query(
    `TRUNCATE odds_current, odds_history, event_source_map, sport, league,
              team, sport_source_map, league_source_map, team_source_map
     RESTART IDENTITY CASCADE`,
  );
});

const h2h = (home: number, away: number, draw?: number): Market => ({
  key: "h2h",
  selections: [
    { key: "home", name: "A", odds: home },
    { key: "away", name: "B", odds: away },
    ...(draw !== undefined ? [{ key: "draw", name: "Draw", odds: draw }] : []),
  ],
});

const event = (
  eventId = "mock:e1",
  overrides: Partial<CanonicalEvent> = {},
): CanonicalEvent => ({
  eventId,
  origin: "mock",
  sourceEventId: eventId.slice(eventId.indexOf(":") + 1),
  sport: "soccer_epl",
  homeTeam: "A",
  awayTeam: "B",
  commenceTime: 1717200000000,
  markets: [
    h2h(1.5, 2.5, 3.2),
    {
      key: "totals",
      selections: [
        { key: "over", name: "Over", odds: 1.9, point: 2.5 },
        { key: "under", name: "Under", odds: 1.95, point: 2.5 },
      ],
    },
  ],
  updatedAt: 1000,
  ...overrides,
});

const scalar = async (sql: string): Promise<unknown> => {
  const rows = (await dataSource.query(sql)) as Record<string, unknown>[];
  return Object.values(rows[0])[0];
};

const column = async (sql: string): Promise<unknown[]> => {
  const rows = (await dataSource.query(sql)) as Record<string, unknown>[];
  return rows.map((r) => Object.values(r)[0]);
};

describe("record / read round-trip", () => {
  it("round-trips the full market model through JSONB", async () => {
    await storage.record(event());

    const got = await storage.getCurrent("mock:e1");
    expect(got).not.toBeNull();
    if (!got) {
      return;
    }
    expect(got.origin).toBe("mock");
    expect(got.sourceEventId).toBe("e1");
    expect(got.commenceTime).toBe(1717200000000);

    const gotH2h = market(got, "h2h");
    expect(
      Object.fromEntries(
        (gotH2h as Market).selections.map((s) => [s.key, s.odds]),
      ),
    ).toEqual({ home: 1.5, away: 2.5, draw: 3.2 });

    // Non-h2h markets and their `point` survive the JSONB round-trip.
    const over = market(got, "totals")?.selections.find(
      (s) => s.key === "over",
    );
    expect(over?.point).toBe(2.5);
  });

  it("returns null for an unknown event", async () => {
    expect(await storage.getCurrent("mock:nope")).toBeNull();
  });

  it("upserts current but appends history", async () => {
    await storage.record(event("mock:e1", { updatedAt: 1000 }));
    await storage.record(
      event("mock:e1", { updatedAt: 2000, markets: [h2h(1.1, 9.0)] }),
    );

    const got = await storage.getCurrent("mock:e1");
    // odds_current is upserted to the latest tick...
    expect(got?.updatedAt).toBe(2000);
    expect(
      market(got as CanonicalEvent, "h2h")?.selections.find(
        (s) => s.key === "home",
      )?.odds,
    ).toBe(1.1);
    // ...while odds_history keeps every tick.
    expect(
      Number(
        await scalar(
          "SELECT count(*) FROM odds_history WHERE event_id = 'mock:e1'",
        ),
      ),
    ).toBe(2);
  });
});

describe("listing and filtering", () => {
  it("orders by updatedAt desc and filters by canonical sport slug", async () => {
    await storage.record(
      event("mock:a", { sport: "soccer_epl", updatedAt: 100 }),
    );
    await storage.record(
      event("mock:b", { sport: "soccer_epl", updatedAt: 300 }),
    );
    await storage.record(
      event("mock:c", { sport: "basketball_nba", updatedAt: 200 }),
    );

    expect((await storage.listCurrent()).map((e) => e.eventId)).toEqual([
      "mock:b",
      "mock:c",
      "mock:a",
    ]);
    // Filtering is by canonical sport slug (soccer_epl -> "soccer"), so both
    // soccer events match while the basketball one is excluded.
    expect((await storage.listCurrent("soccer")).map((e) => e.eventId)).toEqual(
      ["mock:b", "mock:a"],
    );
  });

  it("returns deduped canonical sports ordered by title", async () => {
    await storage.record(
      event("mock:a", { sport: "soccer_epl", updatedAt: 100 }),
    );
    await storage.record(
      event("mock:b", { sport: "soccer_laliga", updatedAt: 200 }),
    );
    await storage.record(
      event("mock:c", { sport: "basketball_nba", updatedAt: 300 }),
    );

    // Both soccer leagues collapse onto one canonical "soccer".
    expect((await storage.listSports()).map((s) => [s.slug, s.title])).toEqual([
      ["basketball", "Basketball"],
      ["soccer", "Soccer"],
    ]);
  });

  it("filters unresolved events by origin, outcome and kickoff window", async () => {
    const pendingEvent = (
      id: string,
      origin: string,
      commenceTime: number | null,
    ) => storage.record(event(id, { origin, commenceTime }));

    // In-window, unresolved, right provider — these three should come back.
    await pendingEvent("apifootball:1", "apifootball", 1000);
    await pendingEvent("apifootball:2", "apifootball", 3000);
    await pendingEvent("apifootball:3", "apifootball", 2000);
    // Another provider's event.
    await pendingEvent("theoddsapi:1", "theoddsapi", 2000);
    // Already resolved.
    await pendingEvent("apifootball:done", "apifootball", 2000);
    await storage.recordResult({
      eventId: "apifootball:done",
      sport: "soccer_epl",
      outcome: "home",
      resolvedAt: 9,
    });
    // Kicked off too recently (still in play) and kickoff unknown.
    await pendingEvent("apifootball:live", "apifootball", 8000);
    await pendingEvent("apifootball:nokickoff", "apifootball", null);

    const pending = await storage.listUnresolved("apifootball", 500, 5000, 10);

    // Oldest kickoff first, everything else excluded.
    expect(pending.map((e) => e.eventId)).toEqual([
      "apifootball:1",
      "apifootball:3",
      "apifootball:2",
    ]);
    // The provider queries its own API by source id, so that has to survive.
    expect(pending.map((e) => e.sourceEventId)).toEqual(["1", "3", "2"]);

    const capped = await storage.listUnresolved("apifootball", 500, 5000, 2);
    expect(capped.map((e) => e.eventId)).toEqual([
      "apifootball:1",
      "apifootball:3",
    ]);
  });
});

describe("recordResult", () => {
  it("sets the outcome without clobbering the odds", async () => {
    await storage.record(event());
    await storage.recordResult({
      eventId: "mock:e1",
      sport: "soccer_epl",
      outcome: "home",
      resolvedAt: 5000,
    });

    const got = await storage.getCurrent("mock:e1");
    expect(got?.outcome).toBe("home");
    expect(got?.resolvedAt).toBe(5000);
    // The conflict path updates only outcome/resolvedAt — odds stay put.
    expect(market(got as CanonicalEvent, "h2h")).toBeDefined();
  });

  it("inserts a bare mock row for an unknown event", async () => {
    await storage.recordResult({
      eventId: "mock:bare",
      sport: "soccer_epl",
      outcome: "draw",
      resolvedAt: 7000,
    });

    const got = await storage.getCurrent("mock:bare");
    expect(got?.origin).toBe("mock");
    expect(got?.outcome).toBe("draw");
    expect(got?.markets).toEqual([]);
  });

  it("does not un-resolve an event on the next odds tick", async () => {
    // CURRENT_UPDATE_COLS deliberately excludes outcome/resolved_at.
    await storage.record(event("mock:e1", { updatedAt: 1000 }));
    await storage.recordResult({
      eventId: "mock:e1",
      sport: "soccer_epl",
      outcome: "away",
      resolvedAt: 5000,
    });
    await storage.record(event("mock:e1", { updatedAt: 6000 }));

    const got = await storage.getCurrent("mock:e1");
    expect(got?.outcome).toBe("away");
    expect(got?.resolvedAt).toBe(5000);
  });
});

// ── Entity resolution ────────────────────────────────────────────────────────

const entityEvent = (
  origin: string,
  sourceId: string,
  overrides: Partial<CanonicalEvent> = {},
): CanonicalEvent => ({
  eventId: `${origin}:${sourceId}`,
  origin,
  sourceEventId: sourceId,
  sport: "soccer_epl",
  homeTeam: "Arsenal",
  awayTeam: "Chelsea",
  markets: [h2h(1.5, 2.5)],
  updatedAt: 1000,
  leagueKey: "soccer_epl",
  leagueName: "Premier League",
  country: "England",
  ...overrides,
});

describe("entity resolution", () => {
  it("creates and links canonical entities", async () => {
    await storage.record(entityEvent("mock", "epl-001"));

    expect(await scalar("SELECT slug FROM sport")).toBe("soccer");
    expect(await scalar("SELECT match_key FROM league")).toBe("premier league");
    expect(Number(await scalar("SELECT count(*) FROM team"))).toBe(2);

    // The odds row carries the resolved canonical links.
    expect(await scalar("SELECT sport_slug FROM odds_current")).toBe("soccer");
    expect(await scalar("SELECT league_id FROM odds_current")).not.toBeNull();
    expect(
      await scalar("SELECT home_team_id FROM odds_current"),
    ).not.toBeNull();
    expect(
      await scalar("SELECT away_team_id FROM odds_current"),
    ).not.toBeNull();
  });

  it("merges two providers onto one league and team", async () => {
    // The Odds API: short team name, no ids, league "EPL", no country.
    await storage.record(
      entityEvent("theoddsapi", "x1", {
        leagueKey: "soccer_epl",
        leagueName: "EPL",
        country: null,
        homeTeam: "Man City",
      }),
    );
    // API-Football: full name + numeric ids, league "Premier League" / England.
    await storage.record(
      entityEvent("apifootball", "42", {
        leagueKey: "39",
        leagueName: "Premier League",
        country: "England",
        homeTeam: "Manchester City",
        homeTeamKey: "50",
        awayTeamKey: "49",
      }),
    );

    // One canonical league, enriched with the country the odds API lacked...
    expect(Number(await scalar("SELECT count(*) FROM league"))).toBe(1);
    expect(await scalar("SELECT country FROM league")).toBe("England");
    // ...reached from both providers via distinct source keys.
    expect(Number(await scalar("SELECT count(*) FROM league_source_map"))).toBe(
      2,
    );

    // "Man City" and "Manchester City" collapsed; Chelsea shared -> 2 teams.
    expect(Number(await scalar("SELECT count(*) FROM team"))).toBe(2);

    const homeIds = await column(
      "SELECT home_team_id FROM odds_current ORDER BY event_id",
    );
    const leagueIds = await column("SELECT league_id FROM odds_current");
    expect(homeIds[0]).toBe(homeIds[1]);
    expect(new Set(leagueIds).size).toBe(1);
  });

  it("keeps distinct names separate", async () => {
    await storage.record(entityEvent("mock", "a"));
    await storage.record(
      entityEvent("mock", "b", { homeTeam: "Liverpool", awayTeam: "Everton" }),
    );
    expect(Number(await scalar("SELECT count(*) FROM team"))).toBe(4);
  });

  it("is idempotent on re-ingest", async () => {
    const e = entityEvent("mock", "epl-001");
    await storage.record(e);
    await storage.record(e);

    expect(Number(await scalar("SELECT count(*) FROM league"))).toBe(1);
    expect(Number(await scalar("SELECT count(*) FROM team"))).toBe(2);
    expect(Number(await scalar("SELECT count(*) FROM league_source_map"))).toBe(
      1,
    );
    expect(Number(await scalar("SELECT count(*) FROM team_source_map"))).toBe(
      2,
    );
  });

  it("leaves the league link null but still resolves the sport", async () => {
    await storage.record(
      entityEvent("mock", "z", {
        leagueKey: null,
        leagueName: null,
        country: null,
      }),
    );
    expect(await scalar("SELECT league_id FROM odds_current")).toBeNull();
    expect(Number(await scalar("SELECT count(*) FROM league"))).toBe(0);
    expect(await scalar("SELECT sport_slug FROM odds_current")).toBe("soccer");
  });

  it("surfaces merged canonical names on the read path", async () => {
    // API-Football seen first fixes the first-seen canonical names...
    await storage.record(
      entityEvent("apifootball", "42", {
        leagueKey: "39",
        leagueName: "Premier League",
        homeTeam: "Manchester City",
        homeTeamKey: "50",
        awayTeamKey: "49",
      }),
    );
    // ...then the short-name Odds API event merges onto them.
    await storage.record(
      entityEvent("theoddsapi", "x1", {
        leagueName: "EPL",
        country: null,
        homeTeam: "Man City",
      }),
    );

    const events = new Map(
      (await storage.listCurrent()).map((e) => [e.eventId, e]),
    );
    // Both events read back the same merged canonical display names via the
    // join, regardless of the raw provider labels each carried.
    for (const id of ["apifootball:42", "theoddsapi:x1"]) {
      const e = events.get(id) as CanonicalEvent;
      expect(e.sportTitle).toBe("Soccer");
      expect(e.leagueName).toBe("Premier League");
      expect(e.homeTeamName).toBe("Manchester City");
      expect(e.awayTeamName).toBe("Chelsea");
    }
  });

  it("leaves names null when unlinked", async () => {
    // No league hints -> league link stays null; the read join must yield null
    // for the league name (not drop the row), while sport/teams still resolve.
    await storage.record(
      entityEvent("mock", "z", {
        leagueKey: null,
        leagueName: null,
        country: null,
      }),
    );
    const [e] = await storage.listCurrent();
    expect(e.leagueName).toBeNull();
    expect(e.sportTitle).toBe("Soccer");
    expect(e.homeTeamName).toBe("Arsenal");
    expect(e.awayTeamName).toBe("Chelsea");
  });

  it("normalizes the americanfootball sport slug", async () => {
    await storage.record(
      entityEvent("mock", "n", {
        sport: "americanfootball_nfl",
        leagueKey: "americanfootball_nfl",
        leagueName: "NFL",
        country: "USA",
        homeTeam: "Kansas City Chiefs",
        awayTeam: "San Francisco 49ers",
      }),
    );
    expect(await scalar("SELECT sport_slug FROM odds_current")).toBe(
      "american_football",
    );
  });
});

describe("listLeagues", () => {
  it("returns canonical leagues ordered by name, optionally scoped to a sport", async () => {
    const leagueEvent = (id: string, sport: string, league: string) =>
      storage.record(
        entityEvent("mock", id, {
          eventId: `mock:${id}`,
          sport,
          leagueKey: league,
          leagueName: league,
          country: null,
        }),
      );
    await leagueEvent("a", "soccer_epl", "Premier League");
    await leagueEvent("b", "soccer_laliga", "La Liga");
    await leagueEvent("c", "basketball_nba", "NBA");

    expect(
      (await storage.listLeagues()).map((l) => [l.name, l.sportSlug]),
    ).toEqual([
      ["La Liga", "soccer"],
      ["NBA", "basketball"],
      ["Premier League", "soccer"],
    ]);
    expect(
      new Set((await storage.listLeagues("soccer")).map((l) => l.name)),
    ).toEqual(new Set(["Premier League", "La Liga"]));
  });
});
