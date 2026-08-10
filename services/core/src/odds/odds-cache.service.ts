import {
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { MAX_ODDS, MIN_ODDS } from "../common/money";
import { OddsEventSchema, OddsUpdatedEventSchema } from "../generated/events";
import { MessagingService } from "../messaging/messaging.service";

type Selection = "home" | "away" | "draw";

// Fire-and-forget, like the odds service's own publish side: a dropped tick
// only leaves a slightly older price in the cache, and both the next tick and
// the boot hydrate repair it. A durable queue here would accumulate while core
// is down and then replay prices that are already worthless.
const ODDS_EXCHANGE = "odds.updated";

// The boot hydrate is what closes the restart window — without it the cache is
// empty, and every placement rejected, until the odds service's next poll
// (POLL_INTERVAL_SECONDS, tens of minutes). Core and odds start together, so an
// empty response usually means odds hasn't written its first tick yet. The
// retry budget has to comfortably outlast a cold odds boot for that reason:
// giving up early costs a whole poll interval of closed betting.
const HYDRATE_ATTEMPTS = 12;
const HYDRATE_BACKOFF_MS = 2_000;
const HYDRATE_MAX_BACKOFF_MS = 30_000;
const HYDRATE_TIMEOUT_MS = 5_000;

interface Entry {
  homeOdds: number;
  awayOdds: number;
  drawOdds: number;
  updatedAt: number;
  resolved: boolean;
}

/**
 * Core's read-only replica of the current h2h line, fed by the `odds.updated`
 * fanout and warmed at boot from the odds service's hydrate endpoint.
 *
 * It exists so `bets` can stamp a server-known price onto a bet instead of
 * trusting the one the client posted, without putting a synchronous call to
 * the odds service on the placement path.
 */
@Injectable()
export class OddsCacheService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(OddsCacheService.name);
  private readonly entries = new Map<string, Entry>();
  private readonly baseUrl: string;
  private readonly maxAgeMs: number;
  private retryTimer?: NodeJS.Timeout;
  private stopped = false;

  constructor(
    config: ConfigService,
    private readonly messaging: MessagingService,
  ) {
    this.baseUrl = config.get<string>("ODDS_SERVICE_URL", "http://odds:8000");
    // Must stay above the odds service's poll interval, or a price that is
    // merely un-refreshed reads as stale and blocks betting entirely.
    this.maxAgeMs = Number(config.get("ODDS_MAX_AGE_MS", "21600000"));
  }

  async onModuleInit(): Promise<void> {
    // Subscribe before hydrating so a tick landing mid-hydrate isn't lost; the
    // `updatedAt` check in `upsert` keeps the older hydrate from clobbering it.
    await this.messaging.subscribe(ODDS_EXCHANGE, (raw) => this.applyTick(raw));
    // Deliberately not awaited. The hydrate is a cache warm-up, not a
    // dependency: blocking boot on it would make core's readiness hostage to
    // the odds service, which is the coupling this whole module avoids.
    void this.hydrate();
  }

  onModuleDestroy(): void {
    this.stopped = true;
    clearTimeout(this.retryTimer);
  }

  /**
   * The price a bet on `selection` should be stamped with, or null when core
   * has no line it is willing to stand behind — unknown event, resolved event,
   * a cache gone stale, or a market this event doesn't offer.
   */
  priceFor(eventId: string, selection: Selection): number | null {
    const entry = this.entries.get(eventId);
    if (!entry || entry.resolved) {
      return null;
    }
    if (Date.now() - entry.updatedAt > this.maxAgeMs) {
      return null;
    }
    const price =
      selection === "home"
        ? entry.homeOdds
        : selection === "away"
          ? entry.awayOdds
          : entry.drawOdds;
    // 0 is the feed's "no such market" (no h2h at all, or no draw in a two-way
    // sport). The range check is the invariant the DTO used to carry: now that
    // the server stamps the price, this is the only thing standing between a
    // garbage feed value and `profitCents`.
    return price >= MIN_ODDS && price <= MAX_ODDS ? price : null;
  }

  /**
   * Settled events stop being bettable. Driven from the `events.resolved`
   * consumer in `bets`, which is already durable and exactly-once — a second
   * subscription here would need its own queue for no extra guarantee.
   */
  markResolved(eventId: string): void {
    const entry = this.entries.get(eventId);
    if (entry) {
      entry.resolved = true;
    }
  }

  applyTick(raw: Buffer): void {
    let tick: ReturnType<typeof OddsUpdatedEventSchema.parse>;
    try {
      tick = OddsUpdatedEventSchema.parse(JSON.parse(raw.toString()));
    } catch (err) {
      this.logger.warn(`Ignoring malformed odds tick: ${String(err)}`);
      return;
    }
    this.upsert(tick.eventId, tick);
  }

  private async hydrate(): Promise<void> {
    for (
      let attempt = 1;
      attempt <= HYDRATE_ATTEMPTS && !this.stopped;
      attempt++
    ) {
      const count = await this.hydrateOnce();
      if (count > 0) {
        this.logger.log(`Hydrated ${count} event(s) from ${this.baseUrl}`);
        return;
      }
      // Ticks arriving while we retried have already done the job.
      if (this.entries.size > 0) {
        return;
      }
      await new Promise((resolve) => {
        this.retryTimer = setTimeout(
          resolve,
          Math.min(HYDRATE_BACKOFF_MS * attempt, HYDRATE_MAX_BACKOFF_MS),
        );
      });
    }
    if (this.entries.size === 0) {
      // Non-fatal: ticks still fill the cache. Placements are rejected until
      // one arrives, which is the fail-closed behaviour we want anyway.
      this.logger.warn(
        `Odds hydrate produced nothing after ${HYDRATE_ATTEMPTS} attempts; betting stays closed until the first tick`,
      );
    }
  }

  private async hydrateOnce(): Promise<number> {
    try {
      const res = await fetch(`${this.baseUrl}/odds/events`, {
        signal: AbortSignal.timeout(HYDRATE_TIMEOUT_MS),
      });
      if (!res.ok) {
        this.logger.warn(`Odds hydrate returned ${res.status}`);
        return 0;
      }
      const events = OddsEventSchema.array().parse(await res.json());
      let count = 0;
      for (const event of events) {
        // A concluded event is never bettable, and it can still be in the
        // feed — mark it so a later tick can't quietly reopen it.
        if (event.outcome != null) {
          this.entries.set(event.eventId, {
            homeOdds: 0,
            awayOdds: 0,
            drawOdds: 0,
            updatedAt: event.updatedAt,
            resolved: true,
          });
          continue;
        }
        this.upsert(event.eventId, event);
        count++;
      }
      return count;
    } catch (err) {
      this.logger.warn(`Odds hydrate failed: ${String(err)}`);
      return 0;
    }
  }

  private upsert(
    eventId: string,
    odds: {
      homeOdds: number;
      awayOdds: number;
      drawOdds: number;
      updatedAt: number;
    },
  ): void {
    const existing = this.entries.get(eventId);
    // Resolved is terminal, and an out-of-order message must not walk the price
    // backwards — the hydrate races the ticks it was started alongside.
    if (
      existing?.resolved ||
      (existing && existing.updatedAt >= odds.updatedAt)
    ) {
      return;
    }
    this.entries.set(eventId, {
      homeOdds: odds.homeOdds,
      awayOdds: odds.awayOdds,
      drawOdds: odds.drawOdds,
      updatedAt: odds.updatedAt,
      resolved: false,
    });
  }
}
