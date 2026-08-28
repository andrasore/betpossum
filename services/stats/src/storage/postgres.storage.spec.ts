/**
 * Storage boundary tests: idempotent upsert, per-user scoping, leaderboard.
 *
 * Drives the real PostgresStorage against a real Postgres (testcontainers),
 * because the behaviour under test is ON CONFLICT DO NOTHING and TypeORM's
 * bigint handling — neither of which a mocked repository would exercise.
 */
import {
  PostgreSqlContainer,
  type StartedPostgreSqlContainer,
} from "@testcontainers/postgresql";
import { DataSource } from "typeorm";
import { PostgresStorage } from "./postgres.storage";
import { Settlement } from "./settlement.entity";

jest.setTimeout(120_000);

let container: StartedPostgreSqlContainer;
let dataSource: DataSource;
let store: PostgresStorage;

beforeAll(async () => {
  container = await new PostgreSqlContainer("postgres:16-alpine").start();
  dataSource = new DataSource({
    type: "postgres",
    url: container.getConnectionUri(),
    entities: [Settlement],
    synchronize: true,
  });
  await dataSource.initialize();
  store = new PostgresStorage(dataSource.getRepository(Settlement));
});

afterAll(async () => {
  await dataSource?.destroy();
  await container?.stop();
});

beforeEach(async () => {
  await dataSource.getRepository(Settlement).clear();
});

const record = (
  overrides: Partial<{
    betId: string;
    userId: string;
    userName: string | null;
    settledAt: number;
    stakeCents: number;
    profitCents: number;
  }> = {},
) =>
  store.recordSettlement({
    betId: "b1",
    userId: "u1",
    userName: null,
    settledAt: 1_700_000_000_000,
    stakeCents: 10_000,
    profitCents: 5_000,
    ...overrides,
  });

it("treats a duplicate betId as a no-op", async () => {
  await record({ betId: "b1", stakeCents: 10_000, profitCents: 5_000 });
  // Redelivery with a different (stale) amount must not overwrite or double-count.
  await record({ betId: "b1", stakeCents: 99_999, profitCents: 1 });

  const rows = await store.userRows("u1");
  expect(rows).toHaveLength(1);
  expect(rows[0].stakeCents).toBe(10_000);
  expect(rows[0].profitCents).toBe(5_000);
});

it("scopes and orders user rows by settledAt", async () => {
  await record({ betId: "b2", userId: "u1", settledAt: 200 });
  await record({ betId: "b1", userId: "u1", settledAt: 100 });
  await record({ betId: "b3", userId: "u2", settledAt: 150 });

  const rows = await store.userRows("u1");
  expect(rows.map((r) => r.settledAt)).toEqual([100, 200]);
});

it("returns cents as numbers, not bigint strings", async () => {
  await record({ betId: "b1", stakeCents: 333, profitCents: 167 });

  const [row] = await store.userRows("u1");
  expect(typeof row.stakeCents).toBe("number");
  expect(row.stakeCents + row.profitCents).toBe(500);
});

it("filters the leaderboard by minSettled and ranks by ROI", async () => {
  // winner: 2 bets, +100 on 200 staked => 50% ROI
  await record({
    betId: "w1",
    userId: "winner",
    userName: "Win",
    stakeCents: 10_000,
    profitCents: 10_000,
  });
  await record({
    betId: "w2",
    userId: "winner",
    userName: "Win",
    stakeCents: 10_000,
    profitCents: 0,
  });
  // midfield: 2 bets, +20 on 200 => 10% ROI
  await record({
    betId: "m1",
    userId: "mid",
    userName: "Mid",
    stakeCents: 10_000,
    profitCents: 2_000,
  });
  await record({
    betId: "m2",
    userId: "mid",
    userName: "Mid",
    stakeCents: 10_000,
    profitCents: 0,
  });
  // lone big winner with only 1 bet — excluded by minSettled=2
  await record({
    betId: "x1",
    userId: "lucky",
    userName: "Lucky",
    stakeCents: 100,
    profitCents: 100_000,
  });

  const board = await store.leaderboard({ minSettled: 2, limit: 10 });
  expect(board.map((e) => e.userId)).toEqual(["winner", "mid"]);
  expect(board[0].roiPct).toBe(50);
  expect(board[0].netProfitCents).toBe(10_000);
});

it("caps the leaderboard at the limit", async () => {
  for (const user of ["a", "b", "c"]) {
    await record({
      betId: `${user}1`,
      userId: user,
      stakeCents: 100,
      profitCents: 10,
    });
  }

  const board = await store.leaderboard({ minSettled: 1, limit: 2 });
  expect(board).toHaveLength(2);
});
