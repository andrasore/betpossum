import { randomUUID } from "node:crypto";
import { ConfigService } from "@nestjs/config";
import { Test } from "@nestjs/testing";
import { getRepositoryToken, TypeOrmModule } from "@nestjs/typeorm";
import {
  PostgreSqlContainer,
  type StartedPostgreSqlContainer,
} from "@testcontainers/postgresql";
import type { Repository } from "typeorm";
import { MessagingService } from "../messaging/messaging.service";
import { NotificationsClient } from "../notifications/notifications.client";
import { OddsCacheService } from "../odds/odds-cache.service";
import { User } from "../users/user.entity";
import { UsersService } from "../users/users.service";
import {
  startTigerBeetle,
  type TbInstance,
} from "../wallet/tigerbeetle-harness";
import { WalletService } from "../wallet/wallet.service";
import { Bet } from "./bet.entity";
import { BetsService } from "./bets.service";

const newId = (): string => randomUUID();

const encodeEvent = (eventId: string, outcome: string): Buffer =>
  Buffer.from(
    JSON.stringify({
      eventId,
      sport: "soccer_epl",
      outcome,
      resolvedAt: Date.now(),
    }),
  );

describe("BetsService", () => {
  let tb: TbInstance;
  let pg: StartedPostgreSqlContainer;
  let wallet: WalletService;
  let bets: BetsService;
  let oddsCache: OddsCacheService;
  let userRepo: Repository<User>;
  let betRepo: Repository<Bet>;
  const notifications = {
    betHeld: jest.fn(),
    betSettled: jest.fn(),
    balanceUpdated: jest.fn(),
  };
  const messaging = { publish: jest.fn(), subscribe: jest.fn() };

  beforeAll(async () => {
    tb = await startTigerBeetle();
    pg = await new PostgreSqlContainer("postgres:16-alpine").start();

    const moduleRef = await Test.createTestingModule({
      imports: [
        TypeOrmModule.forRoot({
          type: "postgres",
          host: pg.getHost(),
          port: pg.getPort(),
          username: pg.getUsername(),
          password: pg.getPassword(),
          database: pg.getDatabase(),
          entities: [User, Bet],
          synchronize: true,
        }),
        TypeOrmModule.forFeature([User, Bet]),
      ],
      providers: [
        BetsService,
        UsersService,
        WalletService,
        OddsCacheService,
        {
          provide: ConfigService,
          useValue: {
            get: (key: string, fallback?: string) => {
              if (key === "TIGERBEETLE_ADDRESS") {
                return tb.address;
              }
              if (key === "TIGERBEETLE_CLUSTER_ID") {
                return "0";
              }
              return fallback;
            },
          },
        },
        { provide: NotificationsClient, useValue: notifications },
        { provide: MessagingService, useValue: messaging },
      ],
    }).compile();

    wallet = moduleRef.get(WalletService);
    bets = moduleRef.get(BetsService);
    // Deliberately not calling `oddsCache.onModuleInit()`: that would try to
    // hydrate over HTTP. Every test primes it through `quote()` instead, which
    // is the same code path a real `odds.updated` tick takes.
    oddsCache = moduleRef.get(OddsCacheService);
    userRepo = moduleRef.get(getRepositoryToken(User));
    betRepo = moduleRef.get(getRepositoryToken(Bet));
    await wallet.onModuleInit();
  }, 120_000);

  afterAll(async () => {
    wallet?.onModuleDestroy();
    await tb?.shutdown();
    await pg?.stop();
  });

  // Publishes one `odds.updated` tick into the real cache. A tick carries all
  // three prices at once, and an omitted one is 0 — the feed's "no such
  // market", exactly as a two-way sport reports its draw.
  const quote = (
    eventId: string,
    odds: { home?: number; away?: number; draw?: number },
    updatedAt = Date.now(),
  ): void =>
    oddsCache.applyTick(
      Buffer.from(
        JSON.stringify({
          eventId,
          homeOdds: odds.home ?? 0,
          awayOdds: odds.away ?? 0,
          drawOdds: odds.draw ?? 0,
          updatedAt,
        }),
      ),
    );

  const newFundedUser = async (cents: number): Promise<string> => {
    const userId = newId();
    await userRepo.insert({ id: userId, email: null, name: null });
    await wallet.createAccount(userId);
    await wallet.setBalance(userId, cents);
    return userId;
  };

  it("places a bet, holds the stake, and transitions to held", async () => {
    const userId = await newFundedUser(10000);
    notifications.betHeld.mockClear();
    quote("evt-1", { home: 2 });

    const bet = await bets.place(userId, "evt-1", "home", 500);

    expect(bet.status).toBe("held");
    const stored = await betRepo.findOneByOrFail({ id: bet.id });
    expect(stored.status).toBe("held");
    expect(stored.stakeCents).toBe(500);
    expect(Number(stored.odds)).toBe(2);

    expect(await wallet.getBalanceCents(userId)).toBe(9500);

    expect(notifications.betHeld).toHaveBeenCalledWith(userId, bet.id);
  });

  it("settles a winning bet: releases hold, pays profit, updates row", async () => {
    const userId = await newFundedUser(10000);
    quote("evt-2", { home: 3 });
    const bet = await bets.place(userId, "evt-2", "home", 1000);
    notifications.betSettled.mockClear();

    // stake 1000c at odds 3 → profit = 1000 * (3 - 1) = 2000c
    await bets.settle(bet.id, true, 2000);

    const stored = await betRepo.findOneByOrFail({ id: bet.id });
    expect(stored.status).toBe("won");
    expect(stored.payoutCents).toBe(2000);

    // release voids the 1000c hold (stake returns) + payout adds 2000c profit.
    expect(await wallet.getBalanceCents(userId)).toBe(12000);

    expect(notifications.betSettled).toHaveBeenCalledWith(
      userId,
      bet.id,
      true,
      2000,
    );
  });

  it("publishes a durable BetSettledEvent carrying the denormalized fields", async () => {
    const userId = await newFundedUser(10000);
    await userRepo.update(userId, { name: "Ada" });
    quote("evt-evt", { home: 3 });
    const bet = await bets.place(userId, "evt-evt", "home", 1000);
    messaging.publish.mockClear();

    await bets.settle(bet.id, true, 2000);

    const settledCall = messaging.publish.mock.calls.find(
      ([channel]) => channel === "bets.settled",
    );
    expect(settledCall).toBeDefined();
    const [, payload, opts] = settledCall as [string, Buffer, unknown];
    expect(opts).toEqual({ durable: true });

    const event = JSON.parse(payload.toString());
    expect(event).toMatchObject({
      userId,
      userName: "Ada",
      betId: bet.id,
      eventId: "evt-evt",
      selection: "home",
      odds: 3,
      stakeCents: 1000,
      won: true,
      payoutCents: 2000, // profit only
    });
    expect(typeof event.settledAt).toBe("number");
  });

  it("settles a losing bet: keeps the hold, no payout", async () => {
    const userId = await newFundedUser(10000);
    quote("evt-3", { home: 3 });
    const bet = await bets.place(userId, "evt-3", "home", 1000);
    notifications.betSettled.mockClear();

    await bets.settle(bet.id, false, 0);

    const stored = await betRepo.findOneByOrFail({ id: bet.id });
    expect(stored.status).toBe("lost");
    expect(stored.payoutCents).toBe(0);

    // keep makes the 1000c hold permanent → balance drops by stake.
    expect(await wallet.getBalanceCents(userId)).toBe(9000);

    expect(notifications.betSettled).toHaveBeenCalledWith(
      userId,
      bet.id,
      false,
      0,
    );
  });

  it("settle throws when called twice — duplicate invocations are the caller-side bug", async () => {
    const userId = await newFundedUser(10000);
    quote("evt-twice", { home: 3 });
    const bet = await bets.place(userId, "evt-twice", "home", 1000);

    await bets.settle(bet.id, true, 2000);
    const after1 = await wallet.getBalanceCents(userId);
    expect(after1).toBe(12000);

    await expect(bets.settle(bet.id, true, 2000)).rejects.toThrow(
      /status is won/,
    );
    expect(await wallet.getBalanceCents(userId)).toBe(after1);
  });

  it("rounds a fractional stake × odds profit to whole cents, and the ledger matches the row", async () => {
    const userId = await newFundedUser(10000);

    // 333c at odds 1.5 → profit is 166.5c, the one genuinely fractional
    // quantity in the money path. It must land on a single rounded value that
    // both the bet row and the ledger agree on.
    quote("evt-4", { home: 1.5 });
    const bet = await bets.place(userId, "evt-4", "home", 333);
    expect(await wallet.getBalanceCents(userId)).toBe(9667);

    await bets.handleEventResolved(encodeEvent("evt-4", "home"));

    const settled = await betRepo.findOneByOrFail({ id: bet.id });
    expect(settled.payoutCents).toBe(167);
    // stake released (back to 10000) + 167c profit, exactly the stored payout.
    expect(await wallet.getBalanceCents(userId)).toBe(10167);
  });

  it("handleEventResolved settles only held bets on the resolved event; winning selections receive profit", async () => {
    const userA = await newFundedUser(10000);
    const userB = await newFundedUser(10000);

    // Two bets on the event-to-resolve, one bet on an unrelated event.
    quote("evt-win", { home: 3, away: 2 });
    quote("evt-other", { home: 2 });
    const winnerBet = await bets.place(userA, "evt-win", "home", 1000); // matches outcome → wins
    const loserBet = await bets.place(userB, "evt-win", "away", 500); // doesn't match → loses
    const unrelatedBet = await bets.place(userA, "evt-other", "home", 500);

    await bets.handleEventResolved(encodeEvent("evt-win", "home"));

    const winner = await betRepo.findOneByOrFail({ id: winnerBet.id });
    const loser = await betRepo.findOneByOrFail({ id: loserBet.id });
    const unrelated = await betRepo.findOneByOrFail({ id: unrelatedBet.id });

    expect(winner.status).toBe("won");
    expect(winner.payoutCents).toBe(2000); // 1000c * (3-1) = 2000c

    expect(loser.status).toBe("lost");
    expect(loser.payoutCents).toBe(0);

    expect(unrelated.status).toBe("held");

    // userA: +2000c profit; held released. Pre-bet 10000, held -1000 (other), so balance = 10000 + 2000 - 500 (other still held) = 11500
    expect(await wallet.getBalanceCents(userA)).toBe(11500);
    // userB lost stake of $5 = 500c, so balance = 10000 - 500 = 9500
    expect(await wallet.getBalanceCents(userB)).toBe(9500);
  });

  it("handleEventResolved is idempotent — duplicate delivery does not settle bets twice", async () => {
    const userId = await newFundedUser(10000);
    quote("evt-dup", { home: 3 });
    const bet = await bets.place(userId, "evt-dup", "home", 1000);

    await bets.handleEventResolved(encodeEvent("evt-dup", "home"));
    const balanceAfterFirst = await wallet.getBalanceCents(userId);

    // Second delivery finds no 'held' bets for the event (the first delivery
    // moved them to 'won'/'lost'), so settle() is never re-invoked.
    await expect(
      bets.handleEventResolved(encodeEvent("evt-dup", "home")),
    ).resolves.toBeUndefined();

    expect(await wallet.getBalanceCents(userId)).toBe(balanceAfterFirst);
    const settled = await betRepo.findOneByOrFail({ id: bet.id });
    expect(settled.status).toBe("won");
  });

  describe("price is the server's", () => {
    it("stamps the current cached line, and a later tick moves the next bet's price", async () => {
      const userId = await newFundedUser(10000);
      const now = Date.now();

      quote("evt-drift", { home: 2 }, now);
      const first = await bets.place(userId, "evt-drift", "home", 500);
      quote("evt-drift", { home: 5 }, now + 1000);
      const second = await bets.place(userId, "evt-drift", "home", 500);

      expect(
        Number((await betRepo.findOneByOrFail({ id: first.id })).odds),
      ).toBe(2);
      expect(
        Number((await betRepo.findOneByOrFail({ id: second.id })).odds),
      ).toBe(5);
    });

    it("rejects an event core holds no line for, without touching the ledger", async () => {
      const userId = await newFundedUser(10000);

      await expect(
        bets.place(userId, "evt-never-quoted", "home", 500),
      ).rejects.toThrow(/No current odds/);

      expect(await wallet.getBalanceCents(userId)).toBe(10000);
      expect(await betRepo.countBy({ eventId: "evt-never-quoted" })).toBe(0);
    });

    it("rejects a selection the event carries no market for", async () => {
      const userId = await newFundedUser(10000);
      // A two-way sport reports drawOdds 0 — bettable on home/away only.
      quote("evt-two-way", { home: 1.8, away: 2.1 });

      await expect(
        bets.place(userId, "evt-two-way", "draw", 500),
      ).rejects.toThrow(/No current odds/);
      await expect(
        bets.place(userId, "evt-two-way", "home", 500),
      ).resolves.toMatchObject({ status: "held" });
    });

    it("stops accepting bets on an event once it has resolved", async () => {
      const userId = await newFundedUser(10000);
      quote("evt-closed", { home: 3 });
      await bets.place(userId, "evt-closed", "home", 500);

      await bets.handleEventResolved(encodeEvent("evt-closed", "home"));

      await expect(
        bets.place(userId, "evt-closed", "home", 500),
      ).rejects.toThrow(/No current odds/);
      // A straggler tick for a settled event must not reopen the market.
      quote("evt-closed", { home: 3 }, Date.now() + 5000);
      await expect(
        bets.place(userId, "evt-closed", "home", 500),
      ).rejects.toThrow(/No current odds/);
    });
  });
});
