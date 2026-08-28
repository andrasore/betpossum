/**
 * HTTP boundary against a real Postgres: the canonical sport/league chips the
 * dashboard filter bars are built from, the `?league` narrowing, and the admin
 * resolution guard (only mock-origin events may be resolved manually, and a
 * rejected resolution must not persist or publish).
 *
 * Storage is the real PostgresStorage (seeded per test); only the RabbitMQ
 * publisher is faked, since the broker isn't what these guards are about. The
 * real RolesGuard runs, so the 403 path is exercised rather than stubbed away.
 */
import {
  type CanActivate,
  type ExecutionContext,
  type INestApplication,
  Injectable,
  ValidationPipe,
} from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { Test } from "@nestjs/testing";
import {
  PostgreSqlContainer,
  type StartedPostgreSqlContainer,
} from "@testcontainers/postgresql";
import type { Request } from "express";
import request from "supertest";
import { DataSource } from "typeorm";
import { OddsPublisher } from "../publisher/odds.publisher";
import { ODDS_ENTITIES } from "../storage/entities";
import { OddsStorage } from "../storage/odds-storage";
import { PostgresStorage } from "../storage/postgres.storage";
import type { CanonicalEvent, EventResult } from "./models";
import { OddsController } from "./odds.controller";

jest.setTimeout(180_000);

/** Stands in for the real Keycloak strategy; the RolesGuard under test is real. */
let currentUser: { sub: string; roles: string[] } | null = null;

@Injectable()
class StubAuthGuard implements CanActivate {
  canActivate(ctx: ExecutionContext): boolean {
    const req = ctx.switchToHttp().getRequest<Request>();
    if (currentUser) {
      req.user = currentUser;
    }
    return true;
  }
}

class FakePublisher {
  published: EventResult[] = [];
  publish(): Promise<void> {
    return Promise.resolve();
  }
  publishResult(result: EventResult): Promise<void> {
    this.published.push(result);
    return Promise.resolve();
  }
}

let container: StartedPostgreSqlContainer;
let dataSource: DataSource;
let storage: PostgresStorage;
let publisher: FakePublisher;
let app: INestApplication;

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
  publisher = new FakePublisher();

  const moduleRef = await Test.createTestingModule({
    controllers: [OddsController],
    providers: [
      { provide: OddsStorage, useValue: storage },
      { provide: OddsPublisher, useValue: publisher },
      { provide: APP_GUARD, useClass: StubAuthGuard },
    ],
  }).compile();

  app = moduleRef.createNestApplication();
  app.useGlobalPipes(new ValidationPipe({ whitelist: true }));
  await app.init();
});

afterAll(async () => {
  await app?.close();
  await dataSource?.destroy();
  await container?.stop();
});

beforeEach(async () => {
  await dataSource.query(
    `TRUNCATE odds_current, odds_history, event_source_map, sport, league,
              team, sport_source_map, league_source_map, team_source_map
     RESTART IDENTITY CASCADE`,
  );
  publisher.published = [];
  currentUser = { sub: "admin-sub", roles: ["admin"] };
});

const seed = (
  eventId: string,
  overrides: Partial<CanonicalEvent> = {},
): Promise<void> =>
  storage.record({
    eventId,
    origin: "mock",
    sourceEventId: eventId.slice(eventId.indexOf(":") + 1),
    sport: "soccer_epl",
    homeTeam: "A",
    awayTeam: "B",
    markets: [
      {
        key: "h2h",
        selections: [
          { key: "home", name: "A", odds: 1.5 },
          { key: "away", name: "B", odds: 2.5 },
        ],
      },
    ],
    updatedAt: 1,
    ...overrides,
  });

const http = () => request(app.getHttpServer());

describe("GET /odds/sports", () => {
  it("returns deduped canonical chips ordered by display name", async () => {
    await seed("mock:a", { sport: "soccer_epl" });
    await seed("mock:b", { sport: "soccer_laliga" });
    await seed("mock:c", { sport: "basketball_nba" });

    const res = await http().get("/odds/sports").expect(200);
    expect(res.body).toEqual([
      { slug: "basketball", name: "Basketball" },
      { slug: "soccer", name: "Soccer" },
    ]);
  });

  it("is empty when there are no events", async () => {
    const res = await http().get("/odds/sports").expect(200);
    expect(res.body).toEqual([]);
  });

  it("is not captured by the /:eventId route", async () => {
    // /sports must win over /:eventId; otherwise this 404s as a missing event.
    const res = await http().get("/odds/sports").expect(200);
    expect(Array.isArray(res.body)).toBe(true);
  });
});

describe("GET /odds/leagues", () => {
  const seedLeague = (id: string, sport: string, league: string) =>
    seed(`mock:${id}`, {
      sport,
      // Both must be set for the storage entity resolver to persist a league.
      leagueKey: league,
      leagueName: league,
    });

  it("returns canonical chips ordered by name with their parent sport", async () => {
    await seedLeague("a", "soccer_epl", "Premier League");
    await seedLeague("b", "soccer_laliga", "La Liga");
    await seedLeague("c", "basketball_nba", "NBA");

    const res = await http().get("/odds/leagues").expect(200);
    expect(
      res.body.map((l: { name: string; sportSlug: string }) => [
        l.name,
        l.sportSlug,
      ]),
    ).toEqual([
      ["La Liga", "soccer"],
      ["NBA", "basketball"],
      ["Premier League", "soccer"],
    ]);
    expect(
      res.body.every((l: { id: unknown }) => typeof l.id === "number"),
    ).toBe(true);
  });

  it("scopes to a sport", async () => {
    await seedLeague("a", "soccer_epl", "Premier League");
    await seedLeague("b", "soccer_laliga", "La Liga");
    await seedLeague("c", "basketball_nba", "NBA");

    const res = await http()
      .get("/odds/leagues")
      .query({ sport: "soccer" })
      .expect(200);
    expect(new Set(res.body.map((l: { name: string }) => l.name))).toEqual(
      new Set(["Premier League", "La Liga"]),
    );
  });

  it("is not captured by the /:eventId route", async () => {
    const res = await http().get("/odds/leagues").expect(200);
    expect(Array.isArray(res.body)).toBe(true);
  });
});

describe("GET /odds/events", () => {
  it("narrows by league id and reports it back", async () => {
    await seed("mock:a", {
      sport: "soccer_epl",
      leagueKey: "Premier League",
      leagueName: "Premier League",
    });
    await seed("mock:b", {
      sport: "basketball_nba",
      leagueKey: "NBA",
      leagueName: "NBA",
    });

    const leagues = (await http().get("/odds/leagues").expect(200)).body;
    const eplId = leagues.find(
      (l: { name: string }) => l.name === "Premier League",
    ).id;

    const res = await http()
      .get("/odds/events")
      .query({ league: eplId })
      .expect(200);
    expect(res.body.map((e: { eventId: string }) => e.eventId)).toEqual([
      "mock:a",
    ]);
    expect(res.body[0].leagueId).toBe(eplId);
  });

  it("serialises unresolved optional fields as null rather than omitting them", async () => {
    // The frontend's Zod schemas expect the keys present; JSON.stringify would
    // drop them if the mapper left them undefined.
    await seed("mock:a");

    const [event] = (await http().get("/odds/events").expect(200)).body;
    for (const key of [
      "commenceTime",
      "outcome",
      "resolvedAt",
      "leagueId",
      "leagueName",
    ]) {
      expect(event).toHaveProperty(key, null);
    }
    // A resolved entity link is still populated.
    expect(event.sportName).toBe("Soccer");
  });

  it("404s an unknown event", async () => {
    await http().get("/odds/events/mock:gone").expect(404);
  });
});

describe("POST /odds/events/:eventId/result", () => {
  it("resolves a mock event, persists it and fans it out", async () => {
    await seed("mock:e1");

    const res = await http()
      .post("/odds/events/mock:e1/result")
      .send({ outcome: "home" })
      .expect(201);

    expect(res.body.outcome).toBe("home");
    expect(res.body.eventId).toBe("mock:e1");
    const got = await storage.getCurrent("mock:e1");
    expect(got?.outcome).toBe("home");
    expect(publisher.published).toHaveLength(1);
  });

  it.each(["theoddsapi", "apifootball"])(
    "409s a %s-origin event and changes nothing",
    async (origin) => {
      await seed(`${origin}:e1`, { origin });

      await http()
        .post(`/odds/events/${origin}:e1/result`)
        .send({ outcome: "home" })
        .expect(409);

      const got = await storage.getCurrent(`${origin}:e1`);
      expect(got?.outcome).toBeNull();
      expect(publisher.published).toEqual([]);
    },
  );

  it("404s a missing event and publishes nothing", async () => {
    await http()
      .post("/odds/events/mock:gone/result")
      .send({ outcome: "home" })
      .expect(404);
    expect(publisher.published).toEqual([]);
  });

  it("403s a caller without the admin role", async () => {
    await seed("mock:e1");
    currentUser = { sub: "user-sub", roles: ["user"] };

    await http()
      .post("/odds/events/mock:e1/result")
      .send({ outcome: "home" })
      .expect(403);

    expect((await storage.getCurrent("mock:e1"))?.outcome).toBeNull();
    expect(publisher.published).toEqual([]);
  });

  it("400s an invalid outcome", async () => {
    await seed("mock:e1");
    await http()
      .post("/odds/events/mock:e1/result")
      .send({ outcome: "sideways" })
      .expect(400);
    expect(publisher.published).toEqual([]);
  });
});
