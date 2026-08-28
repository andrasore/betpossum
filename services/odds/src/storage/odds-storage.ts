import type {
  CanonicalEvent,
  CanonicalLeague,
  CanonicalSport,
  EventResult,
} from "../odds/models";

/**
 * Persistence for ingested odds. Pluggable via `ODDS_STORAGE`; a new backend is
 * a new subclass wired through the factory in `storage.module.ts`.
 *
 * An abstract class rather than an interface so it doubles as the Nest DI token.
 */
export abstract class OddsStorage {
  abstract record(event: CanonicalEvent): Promise<void>;
  abstract recordResult(result: EventResult): Promise<void>;
  abstract listCurrent(
    sport?: string,
    league?: number,
  ): Promise<CanonicalEvent[]>;
  abstract getCurrent(eventId: string): Promise<CanonicalEvent | null>;
  /**
   * Events from `origin` that have kicked off but carry no outcome yet.
   *
   * Bounded to kickoffs in `(since, before)` — Unix ms — and to `limit` rows, so
   * the results poll does a fixed amount of work per tick and fixtures that
   * never reach a final status age out instead of being retried forever.
   */
  abstract listUnresolved(
    origin: string,
    since: number,
    before: number,
    limit: number,
  ): Promise<CanonicalEvent[]>;
  abstract listSports(): Promise<CanonicalSport[]>;
  abstract listLeagues(sport?: string): Promise<CanonicalLeague[]>;
}
