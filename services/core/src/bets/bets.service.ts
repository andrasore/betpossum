import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Bet } from './bet.entity';
import { NotificationsClient } from '../notifications/notifications.client';
import { WalletService } from '../wallet/wallet.service';

@Injectable()
export class BetsService {
  constructor(
    @InjectRepository(Bet) private readonly repo: Repository<Bet>,
    private readonly notifications: NotificationsClient,
    private readonly wallet: WalletService,
  ) {}

  async place(
    userId: string,
    eventId: string,
    selection: 'home' | 'away' | 'draw',
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
  // called exactly once; the consumer-side idempotency key in `event_results`
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

  findByUser(userId: string) {
    return this.repo.find({ where: { userId }, order: { placedAt: 'DESC' } });
  }
}
