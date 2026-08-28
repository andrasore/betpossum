import { Injectable, Logger, type OnModuleInit } from "@nestjs/common";
import {
  type BetSettledEvent,
  BetSettledEventSchema,
} from "../generated/events";
import { MessagingService } from "../messaging/messaging.service";
import { StatsStorage } from "../storage/stats-storage";

export const BETS_SETTLED_EXCHANGE = "bets.settled";
export const QUEUE_NAME = "stats.bets.settled";
const PREFETCH = 16;

/**
 * Durable consumer for the bets.settled domain event.
 *
 * Mirrors Core's `events.resolved` durability: a durable fanout exchange and a
 * named durable queue with manual ack, so settlements survive a stats outage
 * instead of being dropped (unlike the fire-and-forget `notifications`
 * exchange). Idempotency comes from the ON CONFLICT upsert keyed on betId.
 *
 * A handler throw becomes nack+requeue in MessagingService. There is no
 * dead-letter exchange and no retry cap, so a message that can never be handled
 * requeues forever — same as Core's durable consumer, and a deliberate gap
 * rather than an oversight.
 */
@Injectable()
export class SettlementsConsumer implements OnModuleInit {
  private readonly logger = new Logger(SettlementsConsumer.name);

  constructor(
    private readonly messaging: MessagingService,
    private readonly store: StatsStorage,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.messaging.subscribe(
      BETS_SETTLED_EXCHANGE,
      (raw) => this.handle(raw),
      { durable: true, queueName: QUEUE_NAME, prefetch: PREFETCH },
    );
    this.logger.log("Stats consumer ready");
  }

  async handle(raw: Buffer): Promise<void> {
    // Parse-or-throw: the throw is what makes MessagingService requeue.
    const event = BetSettledEventSchema.parse(JSON.parse(raw.toString()));
    await this.store.recordSettlement({
      betId: event.betId,
      userId: event.userId,
      userName: event.userName ?? null,
      settledAt: event.settledAt,
      stakeCents: event.stakeCents,
      profitCents: signedProfitCents(event),
    });
  }
}

/**
 * +profit on a win, -stake on a loss (so a sum is net P&L).
 *
 * The event already carries integer cents, so nothing is rounded here — that is
 * what keeps this read model bit-identical to Core's ledger.
 */
export function signedProfitCents(event: BetSettledEvent): number {
  return event.won ? event.payoutCents : -event.stakeCents;
}
