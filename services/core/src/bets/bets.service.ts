import { Injectable, Logger, type OnModuleInit } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import type { Repository } from "typeorm";
import {
  BetSettledEventSchema,
  EventResolvedEventSchema,
} from "../generated/events";
import { MessagingService } from "../messaging/messaging.service";
import { NotificationsClient } from "../notifications/notifications.client";
import { UsersService } from "../users/users.service";
import { WalletService } from "../wallet/wallet.service";
import { Bet } from "./bet.entity";

type Selection = "home" | "away" | "draw";

// Durable fanout for the bet-settled domain event consumed by the stats
// service. Distinct from the fire-and-forget `notifications` exchange: stats
// must not drop settlements, so this is durable + persistent like
// `events.resolved`.
const BETS_SETTLED_EXCHANGE = "bets.settled";

@Injectable()
export class BetsService implements OnModuleInit {
  private readonly logger = new Logger(BetsService.name);

  constructor(
    @InjectRepository(Bet) private readonly repo: Repository<Bet>,
    private readonly notifications: NotificationsClient,
    private readonly users: UsersService,
    private readonly wallet: WalletService,
    private readonly messaging: MessagingService,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.messaging.subscribe(
      "events.resolved",
      (raw) => this.handleEventResolved(raw),
      { durable: true, queueName: "core.events.resolved" },
    );
  }

  async place(
    userId: string,
    eventId: string,
    selection: Selection,
    odds: number,
    stake: number,
  ): Promise<Bet> {
    const bet = await this.repo.save(
      this.repo.create({
        userId,
        eventId,
        selection,
        odds,
        stake,
        status: "pending",
      }),
    );

    const stakeCents = Math.round(stake * 100);
    try {
      await this.wallet.hold(userId, bet.id, stakeCents);
    } catch (err) {
      await this.repo.delete(bet.id);
      throw err;
    }
    await this.repo.update(bet.id, { status: "held" });
    await this.notifications.betHeld(userId, bet.id);

    return { ...bet, status: "held" };
  }

  // `payout` is profit only (stake * (odds - 1)), not total return. On win we
  // release the pending hold (stake returns to the user) and pay out the
  // profit separately; on loss we keep the hold (stake transfers to the
  // house). Throws if the bet is not in `held` state — settle is meant to be
  // called exactly once; the `status: 'held'` filter in handleEventResolved
  // prevents duplicate invocations from reaching this method.
  async settle(betId: string, won: boolean, payout: number): Promise<void> {
    const bet = await this.repo.findOneByOrFail({ id: betId });
    if (bet.status !== "held") {
      throw new Error(
        `Cannot settle bet ${betId}: status is ${bet.status}, expected held`,
      );
    }

    if (won) {
      await this.wallet.release(bet.userId, betId);
      const profitCents = Math.round(payout * 100);
      if (profitCents > 0) {
        await this.wallet.payout(bet.userId, betId, profitCents);
      }
    } else {
      await this.wallet.keep(bet.userId, betId);
    }

    await this.repo.update(betId, {
      status: won ? "won" : "lost",
      payout: won ? payout : 0,
    });
    await this.notifications.betSettled(bet.userId, betId, won, payout);
    await this.publishSettled(bet, won, payout);
  }

  // Durable domain event for the stats read model. Carries everything the read
  // side needs (denormalized, incl. display name) so stats never reaches into
  // Core's tables. `payout` is profit only (0 on loss), matching Bet.payout.
  private async publishSettled(
    bet: Bet,
    won: boolean,
    payout: number,
  ): Promise<void> {
    const user = await this.users.findById(bet.userId);
    const event = BetSettledEventSchema.parse({
      userId: bet.userId,
      userName: user?.name ?? null,
      betId: bet.id,
      eventId: bet.eventId,
      selection: bet.selection,
      odds: Number(bet.odds),
      stake: Number(bet.stake),
      won,
      payout: won ? payout : 0,
      settledAt: Date.now(),
    });
    await this.messaging.publish(
      BETS_SETTLED_EXCHANGE,
      Buffer.from(JSON.stringify(event)),
      { durable: true },
    );
  }

  // Idempotency is provided by the `status: 'held'` filter: once a bet is
  // settled it moves to 'won'/'lost' and won't be picked up again. On a
  // mid-batch crash, redelivery resumes from the remaining held bets.
  async handleEventResolved(raw: Buffer): Promise<void> {
    const event = EventResolvedEventSchema.parse(JSON.parse(raw.toString()));
    const outcome: Selection = event.outcome;

    const held = await this.repo.find({
      where: { eventId: event.eventId, status: "held" },
    });
    this.logger.log(
      `Settling ${held.length} held bet(s) on event ${event.eventId} (${outcome})`,
    );

    for (const bet of held) {
      const won = bet.selection === outcome;
      const stake = Number(bet.stake);
      const odds = Number(bet.odds);
      const profit = won ? stake * (odds - 1) : 0;
      await this.settle(bet.id, won, profit);
    }
  }

  findByUser(userId: string) {
    return this.repo.find({ where: { userId }, order: { placedAt: "DESC" } });
  }
}
