import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { CanonicalEvent } from "../odds/models";
import type { OddsProvider } from "../providers/base";
import { ODDS_PROVIDERS } from "../providers/providers.module";
import { OddsPublisher } from "../publisher/odds.publisher";
import { OddsStorage } from "../storage/odds-storage";

// Bounds on the results poll (see `OddsStorage.listUnresolved`). Kickoffs newer
// than the grace window are likely still in play; older than the lookback are
// past the point of chasing, which also drops fixtures that never reach a final
// status. The cap keeps a backlog from turning one tick into dozens of requests.
export const RESULTS_GRACE_MS = 2 * 60 * 60 * 1000; // 2 hours
export const RESULTS_LOOKBACK_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
export const RESULTS_MAX_PENDING = 100;

/**
 * One poll loop per enabled provider, running concurrently.
 *
 * Two shape details are load-bearing: the try/catch is *inside* the loop so a
 * failed tick logs and the worker keeps going, and the delay is a fixed sleep
 * *after* each tick rather than a fixed-rate schedule, so a slow tick can never
 * overlap the next one. `@nestjs/schedule`'s `@Interval()` is not equivalent.
 */
@Injectable()
export class RunnerService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(RunnerService.name);
  private readonly intervalMs: number;
  private readonly stopping = new AbortController();
  private workers: Promise<void>[] = [];

  constructor(
    @Inject(ODDS_PROVIDERS) private readonly providers: OddsProvider[],
    private readonly storage: OddsStorage,
    private readonly publisher: OddsPublisher,
    config: ConfigService,
  ) {
    this.intervalMs =
      Number(config.get<string>("POLL_INTERVAL_SECONDS", "30")) * 1000;
  }

  onApplicationBootstrap(): void {
    this.logger.log(
      `Enabled odds providers: ${this.providers.map((p) => p.name).join(", ")}`,
    );
    this.workers = this.providers.map((provider) => this.run(provider));
  }

  async onModuleDestroy(): Promise<void> {
    this.stopping.abort();
    await Promise.allSettled(this.workers);
    await Promise.allSettled(this.providers.map((p) => p.close()));
  }

  /** This provider's kicked-off-but-unresolved events, or nothing to check. */
  private async pendingEvents(
    provider: OddsProvider,
  ): Promise<CanonicalEvent[]> {
    if (!provider.pollsResults) {
      return [];
    }
    const now = Date.now();
    return this.storage.listUnresolved(
      provider.name,
      now - RESULTS_LOOKBACK_MS,
      now - RESULTS_GRACE_MS,
      RESULTS_MAX_PENDING,
    );
  }

  private async run(provider: OddsProvider): Promise<void> {
    await provider.open();
    while (!this.stopping.signal.aborted) {
      const start = Date.now();
      this.logger.log(`Fetch tick starting for provider ${provider.name}`);
      let events = 0;
      let results = 0;
      try {
        for await (const event of provider.fetchTick()) {
          await this.storage.record(event);
          await this.publisher.publish(event);
          events += 1;
        }
        const pending = await this.pendingEvents(provider);
        for await (const result of provider.fetchResults(pending)) {
          await this.storage.recordResult(result);
          await this.publisher.publishResult(result);
          results += 1;
        }
      } catch (err) {
        this.logger.error(
          `Fetch tick failed for provider ${provider.name} after ${Date.now() - start}ms ` +
            `(${events} events, ${results} results recorded before failure)`,
          err,
        );
      }
      this.logger.log(
        `Fetch tick done for provider ${provider.name} in ${Date.now() - start}ms ` +
          `(${events} events, ${results} results)`,
      );
      await this.sleep(this.intervalMs);
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => {
      const timer = setTimeout(done, ms);
      const signal = this.stopping.signal;
      function done() {
        clearTimeout(timer);
        signal.removeEventListener("abort", done);
        resolve();
      }
      signal.addEventListener("abort", done, { once: true });
    });
  }
}
