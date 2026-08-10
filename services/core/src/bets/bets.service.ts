import {
  ConflictException,
  Injectable,
  Logger,
  type OnModuleInit,
} from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import type { Repository } from "typeorm";
import { profitCents } from "../common/money";
import {
  BetSettledEventSchema,
  EventResolvedEventSchema,
} from "../generated/events";
import { MessagingService } from "../messaging/messaging.service";
import { NotificationsClient } from "../notifications/notifications.client";
import { OddsCacheService } from "../odds/odds-cache.service";
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
    private readonly odds: OddsCacheService,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.messaging.subscribe(
      "events.resolved",
      (raw) => this.handleEventResolved(raw),
      { durable: true, queueName: "core.events.resolved" },
    );
  }

  // The price is the server's, not the client's: whatever the bet slip showed,
  // the bet is stamped with the line core currently holds for that selection.
  // A price core can't vouch for (unknown or resolved event, stale cache, no
  // such market) is a rejection rather than a guess — see `OddsCacheService`.
  // Settlement then reads the stamped odds back off the row, so a bet is
  // always paid at the price it was accepted at.
  async place(
    userId: string,
    eventId: string,
    selection: Selection,
    stakeCents: number,
  ): Promise<Bet> {
    const odds = this.odds.priceFor(eventId, selection);
    if (odds === null) {
      throw new ConflictException(
        `No current odds for ${selection} on event ${eventId}`,
      );
    }

    const bet = await this.repo.save(
      this.repo.create({
        userId,
        eventId,
        selection,
        odds,
        stakeCents,
        status: "pending",
      }),
    );

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

  // `payoutCents` is profit only (stake * (odds - 1)), not total return. On win
  // we release the pending hold (stake returns to the user) and pay out the
  // profit separately; on loss we keep the hold (stake transfers to the
  // house). Throws if the bet is not in `held` state — settle is meant to be
  // called exactly once; the `status: 'held'` filter in handleEventResolved
  // prevents duplicate invocations from reaching this method.
  async settle(
    betId: string,
    won: boolean,
    payoutCents: number,
  ): Promise<void> {
    const bet = await this.repo.findOneByOrFail({ id: betId });
    if (bet.status !== "held") {
      throw new Error(
        `Cannot settle bet ${betId}: status is ${bet.status}, expected held`,
      );
    }

    if (won) {
      await this.wallet.release(bet.userId, betId);
      if (payoutCents > 0) {
        await this.wallet.payout(bet.userId, betId, payoutCents);
      }
    } else {
      await this.wallet.keep(bet.userId, betId);
    }

    await this.repo.update(betId, {
      status: won ? "won" : "lost",
      payoutCents: won ? payoutCents : 0,
    });
    await this.notifications.betSettled(bet.userId, betId, won, payoutCents);
    await this.publishSettled(bet, won, payoutCents);
  }

  // Durable domain event for the stats read model. Carries everything the read
  // side needs (denormalized, incl. display name) so stats never reaches into
  // Core's tables. `payoutCents` is profit only (0 on loss), matching
  // Bet.payoutCents.
  private async publishSettled(
    bet: Bet,
    won: boolean,
    payoutCents: number,
  ): Promise<void> {
    const user = await this.users.findById(bet.userId);
    const event = BetSettledEventSchema.parse({
      userId: bet.userId,
      userName: user?.name ?? null,
      betId: bet.id,
      eventId: bet.eventId,
      selection: bet.selection,
      odds: Number(bet.odds),
      stakeCents: bet.stakeCents,
      won,
      payoutCents: won ? payoutCents : 0,
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
    this.odds.markResolved(event.eventId);

    const held = await this.repo.find({
      where: { eventId: event.eventId, status: "held" },
    });
    this.logger.log(
      `Settling ${held.length} held bet(s) on event ${event.eventId} (${outcome})`,
    );

    for (const bet of held) {
      const won = bet.selection === outcome;
      const profit = won ? profitCents(bet.stakeCents, Number(bet.odds)) : 0;
      await this.settle(bet.id, won, profit);
    }
  }

  findByUser(userId: string) {
    return this.repo.find({ where: { userId }, order: { placedAt: "DESC" } });
  }
}
