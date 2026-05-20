import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Bet } from './bet.entity';
import { NotificationsClient } from '../notifications/notifications.client';
import { WalletService } from '../wallet/wallet.service';
import { MessagingService } from '../messaging/messaging.service';
import { EventResolvedEvent, Outcome } from '../generated/events';

type Selection = 'home' | 'away' | 'draw';

const OUTCOME_MAP: Record<Outcome, Selection | null> = {
  [Outcome.UNSPECIFIED]: null,
  [Outcome.HOME]: 'home',
  [Outcome.AWAY]: 'away',
  [Outcome.DRAW]: 'draw',
};

@Injectable()
export class BetsService implements OnModuleInit {
  private readonly logger = new Logger(BetsService.name);

  constructor(
    @InjectRepository(Bet) private readonly repo: Repository<Bet>,
    private readonly notifications: NotificationsClient,
    private readonly wallet: WalletService,
    private readonly messaging: MessagingService,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.messaging.subscribe(
      'events.resolved',
      (raw) => this.handleEventResolved(raw),
      { durable: true, queueName: 'core.events.resolved' },
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
      this.repo.create({ userId, eventId, selection, odds, stake, status: 'pending' }),
    );

    const stakeCents = Math.round(stake * 100);
    await this.wallet.hold(userId, bet.id, stakeCents);
    await this.repo.update(bet.id, { status: 'held' });
    await this.notifications.toUser(userId, 'bet.held', { betId: bet.id });

    return { ...bet, status: 'held' };
  }

  // `payout` is profit only (stake * (odds - 1)), not total return. On win we
  // release the pending hold (stake returns to the user) and pay out the
  // profit separately; on loss we keep the hold (stake transfers to the
  // house). Throws if the bet is not in `held` state — settle is meant to be
  // called exactly once; the `status: 'held'` filter in handleEventResolved
  // prevents duplicate invocations from reaching this method.
  async settle(betId: string, won: boolean, payout: number): Promise<void> {
    const bet = await this.repo.findOneByOrFail({ id: betId });
    if (bet.status !== 'held') {
      throw new Error(`Cannot settle bet ${betId}: status is ${bet.status}, expected held`);
    }

    const stakeCents = Math.round(Number(bet.stake) * 100);

    if (won) {
      await this.wallet.release(bet.userId, betId, stakeCents);
      const profitCents = Math.round(payout * 100);
      if (profitCents > 0) {
        await this.wallet.payout(bet.userId, betId, profitCents);
      }
    } else {
      await this.wallet.keep(bet.userId, betId, stakeCents);
    }

    await this.repo.update(betId, {
      status: won ? 'won' : 'lost',
      payout: won ? payout : 0,
    });
    await this.notifications.toUser(bet.userId, 'bet.settled', { betId, won, payout });
  }

  // Idempotency is provided by the `status: 'held'` filter: once a bet is
  // settled it moves to 'won'/'lost' and won't be picked up again. On a
  // mid-batch crash, redelivery resumes from the remaining held bets.
  async handleEventResolved(raw: Buffer): Promise<void> {
    const event = EventResolvedEvent.fromBinary(raw);
    const outcome = OUTCOME_MAP[event.outcome];
    if (outcome === null) {
      this.logger.warn(`Ignoring events.resolved for ${event.eventId} with unspecified outcome`);
      return;
    }

    const held = await this.repo.find({
      where: { eventId: event.eventId, status: 'held' },
    });
    this.logger.log(`Settling ${held.length} held bet(s) on event ${event.eventId} (${outcome})`);

    for (const bet of held) {
      const won = bet.selection === outcome;
      const stake = Number(bet.stake);
      const odds = Number(bet.odds);
      const profit = won ? stake * (odds - 1) : 0;
      await this.settle(bet.id, won, profit);
    }
  }

  findByUser(userId: string) {
    return this.repo.find({ where: { userId }, order: { placedAt: 'DESC' } });
  }
}
