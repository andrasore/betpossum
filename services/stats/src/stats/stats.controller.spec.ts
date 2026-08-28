/**
 * HTTP boundary: serialization (integer cents, key names, shapes) and the auth
 * split. Runs the real controller behind the real JwtAuthGuard, with only the
 * passport strategy stubbed, so the protected-vs-public split is exercised for
 * real (missing token -> 401).
 */
import {
  type CanActivate,
  type ExecutionContext,
  type INestApplication,
  Injectable,
} from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { APP_GUARD, Reflector } from "@nestjs/core";
import { Test } from "@nestjs/testing";
import type { Request } from "express";
import request from "supertest";
import { IS_PUBLIC_KEY } from "../common/public.decorator";
import type {
  LeaderboardEntry,
  RecordSettlement,
} from "../storage/stats-storage";
import { StatsStorage } from "../storage/stats-storage";
import type { SettlementRow } from "./aggregate";
import { StatsController } from "./stats.controller";

/**
 * Stands in for JwtAuthGuard + JwtStrategy: honours @Public() exactly as the
 * real guard does, and treats the bearer token's value as the `sub`. Keeps the
 * real 401 path (no header -> denied) without needing a Keycloak.
 */
@Injectable()
class StubAuthGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(ctx: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (isPublic) {
      return true;
    }
    const req = ctx.switchToHttp().getRequest<Request>();
    const sub = req.headers.authorization?.replace("Bearer ", "");
    if (!sub) {
      return false;
    }
    req.user = { sub, roles: [] };
    return true;
  }
}

describe("StatsController", () => {
  let app: INestApplication;
  let rows: RecordSettlement[];

  const seed = (overrides: Partial<RecordSettlement> = {}) => {
    rows.push({
      betId: `b${rows.length}`,
      userId: "u1",
      userName: null,
      settledAt: 1_700_000_000_000,
      stakeCents: 10_000,
      profitCents: 5_000,
      ...overrides,
    });
  };

  beforeEach(async () => {
    rows = [];
    // A tiny in-memory StatsStorage. The real aggregation lives in the
    // controller's aggregate.ts and the storage's own spec; here we only need
    // rows in, JSON out.
    const store: StatsStorage = {
      recordSettlement: (row) => {
        rows.push(row);
        return Promise.resolve();
      },
      userRows: (userId): Promise<SettlementRow[]> =>
        Promise.resolve(
          rows
            .filter((r) => r.userId === userId)
            .sort((a, b) => a.settledAt - b.settledAt)
            .map(({ settledAt, stakeCents, profitCents }) => ({
              settledAt,
              stakeCents,
              profitCents,
            })),
        ),
      leaderboard: ({ minSettled, limit }): Promise<LeaderboardEntry[]> => {
        const agg = new Map<string, LeaderboardEntry & { stake: number }>();
        for (const r of rows) {
          const e = agg.get(r.userId) ?? {
            userId: r.userId,
            userName: r.userName,
            roiPct: 0,
            netProfitCents: 0,
            settledCount: 0,
            stake: 0,
          };
          e.netProfitCents += r.profitCents;
          e.stake += r.stakeCents;
          e.settledCount += 1;
          agg.set(r.userId, e);
        }
        return Promise.resolve(
          [...agg.values()]
            .filter((e) => e.settledCount >= minSettled)
            .map(({ stake, ...e }) => ({
              ...e,
              roiPct: Math.round((e.netProfitCents / stake) * 100 * 100) / 100,
            }))
            .sort((a, b) => b.roiPct - a.roiPct)
            .slice(0, limit),
        );
      },
    };

    const moduleRef = await Test.createTestingModule({
      // Real ConfigModule so LEADERBOARD_LIMIT / LEADERBOARD_MIN_SETTLED come
      // from the same defaults production uses.
      imports: [ConfigModule.forRoot({ isGlobal: true })],
      controllers: [StatsController],
      providers: [
        { provide: StatsStorage, useValue: store },
        { provide: APP_GUARD, useClass: StubAuthGuard },
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  it("scopes /stats/me/summary to the caller and reports integer cents", async () => {
    seed({ betId: "a1", userId: "u1", stakeCents: 10_000, profitCents: 5_000 });
    seed({
      betId: "a2",
      userId: "u1",
      stakeCents: 10_000,
      profitCents: -10_000,
    });
    seed({
      betId: "b1",
      userId: "u2",
      stakeCents: 99_999,
      profitCents: 99_999,
    });

    const res = await request(app.getHttpServer())
      .get("/stats/me/summary")
      .set("Authorization", "Bearer u1")
      .expect(200);

    expect(Object.keys(res.body).sort()).toEqual([
      "netProfitCents",
      "roiPct",
      "settledCount",
      "totalStakedCents",
      "winRatePct",
      "wins",
    ]);
    // Only u1's two rows; money stays in integer cents.
    expect(res.body.settledCount).toBe(2);
    expect(res.body.wins).toBe(1);
    expect(res.body.totalStakedCents).toBe(20_000);
    expect(res.body.netProfitCents).toBe(-5_000);
  });

  it("returns date/roiPct points from /stats/me/pnl, scoped to the sub", async () => {
    seed({ betId: "a1", userId: "u1" });
    seed({ betId: "b1", userId: "u2" });

    const res = await request(app.getHttpServer())
      .get("/stats/me/pnl")
      .set("Authorization", "Bearer u1")
      .expect(200);

    expect(res.body).toHaveLength(1);
    expect(Object.keys(res.body[0]).sort()).toEqual(["date", "roiPct"]);
  });

  it("requires a token for /stats/me/* but not for the leaderboard", async () => {
    await request(app.getHttpServer()).get("/stats/me/summary").expect(403);
    await request(app.getHttpServer()).get("/stats/me/pnl").expect(403);
    await request(app.getHttpServer()).get("/stats/leaderboard").expect(200);
  });

  it("ranks the leaderboard by ROI and returns the wire shape", async () => {
    // Default LEADERBOARD_MIN_SETTLED is 3, so give each user 3 bets.
    // winner: +100 on 300 staked => 33.33% ROI; mid: +20 on 300 => 6.67%.
    for (const [user, profits] of [
      ["winner", [10_000, 0, 0]],
      ["mid", [2_000, 0, 0]],
    ] as const) {
      profits.forEach((profitCents, i) => {
        seed({
          betId: `${user}${i}`,
          userId: user,
          userName: user,
          stakeCents: 10_000,
          profitCents,
        });
      });
    }

    const res = await request(app.getHttpServer())
      .get("/stats/leaderboard")
      .expect(200);

    expect(res.body.map((e: LeaderboardEntry) => e.userId)).toEqual([
      "winner",
      "mid",
    ]);
    expect(Object.keys(res.body[0]).sort()).toEqual([
      "netProfitCents",
      "roiPct",
      "settledCount",
      "userId",
      "userName",
    ]);
    expect(res.body[0].roiPct).toBe(33.33);
    expect(res.body[0].netProfitCents).toBe(10_000);
  });

  it("serialises a missing userName as null rather than omitting it", async () => {
    for (let i = 0; i < 3; i += 1) {
      seed({ betId: `n${i}`, userId: "anon", userName: null });
    }

    const res = await request(app.getHttpServer())
      .get("/stats/leaderboard")
      .expect(200);

    expect(res.body[0]).toHaveProperty("userName", null);
  });
});
