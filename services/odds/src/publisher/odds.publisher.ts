import { Injectable, Logger } from "@nestjs/common";
import {
  EventResolvedEventSchema,
  NotificationEventSchema,
  OddsUpdatedEventSchema,
} from "../generated/events";
import { MessagingService } from "../messaging/messaging.service";
import { type CanonicalEvent, type EventResult, h2hOdds } from "../odds/models";

export const ODDS_EXCHANGE = "odds.updated";
export const RESULTS_EXCHANGE = "events.resolved";
export const NOTIFICATIONS_EXCHANGE = "notifications";

/**
 * Fans ingested odds out to RabbitMQ.
 *
 * Durability differs per exchange and must not drift: `odds.updated` and
 * `notifications` are transient (a dropped tick is replaced by the next one),
 * while `events.resolved` is durable + persistent because a lost resolution
 * leaves bets held forever. Declaring any of them differently from Core's
 * declarations fails the channel with PRECONDITION_FAILED.
 */
@Injectable()
export class OddsPublisher {
  private readonly logger = new Logger(OddsPublisher.name);

  constructor(private readonly messaging: MessagingService) {}

  async publish(event: CanonicalEvent): Promise<void> {
    // The wire contract is 3-way (home/away/draw); project the h2h market onto
    // it. Events without an h2h market are persisted but not emitted.
    const projected = h2hOdds(event);
    if (projected === null) {
      this.logger.log(
        `Skipping wire publish for ${event.eventId} (no h2h market)`,
      );
      return;
    }
    const [homeOdds, awayOdds, drawOdds] = projected;
    // The wire event is a delta: just the changing odds, keyed by event id.
    // Static identity and canonical names ride the GET /odds/events hydrate; the
    // frontend merges this tick onto the already-hydrated event.
    const oddsUpdated = OddsUpdatedEventSchema.parse({
      eventId: event.eventId,
      homeOdds,
      awayOdds,
      drawOdds,
      updatedAt: event.updatedAt,
    });

    await this.messaging.publish(
      ODDS_EXCHANGE,
      Buffer.from(JSON.stringify(oddsUpdated)),
    );

    // The browser's live updates ride the notifications relay, not odds.updated.
    const notification = NotificationEventSchema.parse({
      userId: "",
      kind: "oddsUpdated",
      payload: oddsUpdated,
    });
    await this.messaging.publish(
      NOTIFICATIONS_EXCHANGE,
      Buffer.from(JSON.stringify(notification)),
    );
  }

  async publishResult(result: EventResult): Promise<void> {
    const payload = EventResolvedEventSchema.parse({
      eventId: result.eventId,
      sport: result.sport,
      outcome: result.outcome,
      resolvedAt: result.resolvedAt,
    });
    await this.messaging.publish(
      RESULTS_EXCHANGE,
      Buffer.from(JSON.stringify(payload)),
      { durable: true },
    );
  }
}
