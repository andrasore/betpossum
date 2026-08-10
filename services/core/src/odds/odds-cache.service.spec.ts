import { ConfigService } from "@nestjs/config";
import { Test } from "@nestjs/testing";
import { MAX_ODDS, MIN_ODDS } from "../common/money";
import { MessagingService } from "../messaging/messaging.service";
import { OddsCacheService } from "./odds-cache.service";

const MAX_AGE_MS = 60_000;

const tick = (
  eventId: string,
  odds: { home?: number; away?: number; draw?: number },
  updatedAt = Date.now(),
): Buffer =>
  Buffer.from(
    JSON.stringify({
      eventId,
      homeOdds: odds.home ?? 0,
      awayOdds: odds.away ?? 0,
      drawOdds: odds.draw ?? 0,
      updatedAt,
    }),
  );

describe("OddsCacheService", () => {
  let cache: OddsCacheService;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        OddsCacheService,
        {
          provide: ConfigService,
          useValue: {
            get: (key: string, fallback?: string) =>
              key === "ODDS_MAX_AGE_MS" ? String(MAX_AGE_MS) : fallback,
          },
        },
        {
          provide: MessagingService,
          useValue: { subscribe: jest.fn(), publish: jest.fn() },
        },
      ],
    }).compile();
    cache = moduleRef.get(OddsCacheService);
  });

  it("serves the price for the selection the tick carried", () => {
    cache.applyTick(tick("e1", { home: 1.8, away: 2.1, draw: 3.4 }));

    expect(cache.priceFor("e1", "home")).toBe(1.8);
    expect(cache.priceFor("e1", "away")).toBe(2.1);
    expect(cache.priceFor("e1", "draw")).toBe(3.4);
  });

  it("has no price for an event it never saw", () => {
    expect(cache.priceFor("nope", "home")).toBeNull();
  });

  it("treats the feed's 0 as no market rather than a free bet", () => {
    cache.applyTick(tick("e1", { home: 1.8, away: 2.1 }));

    expect(cache.priceFor("e1", "draw")).toBeNull();
  });

  // The DTO used to hold this range. Nothing else does now, so a provider
  // glitch would otherwise flow straight into `profitCents` and the ledger.
  it("refuses a feed price outside the payout-multiplier range", () => {
    cache.applyTick(tick("low", { home: MIN_ODDS - 0.01 }));
    cache.applyTick(tick("high", { home: MAX_ODDS + 1 }));

    expect(cache.priceFor("low", "home")).toBeNull();
    expect(cache.priceFor("high", "home")).toBeNull();
  });

  it("refuses a price older than the staleness bound", () => {
    cache.applyTick(
      tick("fresh", { home: 2 }, Date.now() - MAX_AGE_MS + 5_000),
    );
    cache.applyTick(tick("stale", { home: 2 }, Date.now() - MAX_AGE_MS - 1));

    expect(cache.priceFor("fresh", "home")).toBe(2);
    expect(cache.priceFor("stale", "home")).toBeNull();
  });

  // The boot hydrate races the ticks it was started alongside, so ordering is
  // decided by `updatedAt`, not by arrival.
  it("keeps the newer price when messages arrive out of order", () => {
    const now = Date.now();
    cache.applyTick(tick("e1", { home: 5 }, now));
    cache.applyTick(tick("e1", { home: 2 }, now - 10_000));

    expect(cache.priceFor("e1", "home")).toBe(5);
  });

  it("closes a market on resolution and keeps a straggler tick from reopening it", () => {
    cache.applyTick(tick("e1", { home: 2 }));
    expect(cache.priceFor("e1", "home")).toBe(2);

    cache.markResolved("e1");
    expect(cache.priceFor("e1", "home")).toBeNull();

    cache.applyTick(tick("e1", { home: 2 }, Date.now() + 10_000));
    expect(cache.priceFor("e1", "home")).toBeNull();
  });

  it("ignores a malformed tick instead of poisoning the cache", () => {
    cache.applyTick(tick("e1", { home: 2 }));
    cache.applyTick(Buffer.from("not json"));
    cache.applyTick(Buffer.from(JSON.stringify({ eventId: "e1" })));

    expect(cache.priceFor("e1", "home")).toBe(2);
  });
});
