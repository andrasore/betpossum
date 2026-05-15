import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Bet } from './bet.entity';
import { EventsGateway } from '../events/events.gateway';
import { WalletService } from '../wallet/wallet.service';

@Injectable()
export class BetsService {
  constructor(
    @InjectRepository(Bet) private readonly repo: Repository<Bet>,
    private readonly gateway: EventsGateway,
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
    this.gateway.sendToUser(userId, 'bet.held', { betId: bet.id });

    return { ...bet, status: 'held' };
  }

  async settle(betId: string, won: boolean, payout: number): Promise<void> {
    await this.repo.update(betId, {
      status: won ? 'won' : 'lost',
      payout: won ? payout : 0,
    });
    const bet = await this.repo.findOneByOrFail({ id: betId });

    if (won) {
      const payoutCents = Math.round(payout * 100);
      await this.wallet.payout(bet.userId, betId, payoutCents);
    }
    this.gateway.sendToUser(bet.userId, 'bet.settled', { betId, won, payout });
  }

  findByUser(userId: string) {
    return this.repo.find({ where: { userId }, order: { placedAt: 'DESC' } });
  }
}
