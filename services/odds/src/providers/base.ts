import type { CanonicalEvent, EventResult } from "../odds/models";

export abstract class OddsProvider {
  abstract readonly name: string;
  /**
   * Whether this provider can discover event conclusions. False keeps the
   * runner from paying for the pending-events query on every tick.
   */
  readonly pollsResults: boolean = false;

  /** Opens any long-lived resources (an HTTP client). */
  async open(): Promise<void> {}
  /** Releases them; called once on shutdown. */
  async close(): Promise<void> {}

  /**
   * Stable canonical id for an event from this provider.
   *
   * Events are kept separate per provider, so the canonical id is simply the
   * provider name namespacing the provider's own id.
   */
  canonicalId(sourceEventId: string): string {
    return `${this.name}:${sourceEventId}`;
  }

  abstract fetchTick(): AsyncGenerator<CanonicalEvent>;

  /**
   * Emit results for any of `pending` that have since concluded.
   *
   * `pending` is the runner's list of this provider's kicked-off-but-open events
   * (see `OddsStorage.listUnresolved`) — the provider stays free of storage
   * access and just answers "which of these are done?". Events with no fair
   * outcome (cancelled, abandoned) are skipped, not guessed at.
   *
   * Default is empty; providers that know about event conclusions override and
   * set `pollsResults = true`.
   */
  // biome-ignore lint/correctness/useYield: the default is an empty stream.
  async *fetchResults(_pending: CanonicalEvent[]): AsyncGenerator<EventResult> {
    return;
  }
}
