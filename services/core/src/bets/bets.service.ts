import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { v4 as uuidv4 } from 'uuid';
import * as protobuf from 'protobufjs';
import * as path from 'path';
import { Bet } from './bet.entity';
import { RedisService } from '../redis/redis.service';
import { EventsGateway } from '../events/events.gateway';

@Injectable()
export class BetsService implements OnModuleInit {
  private readonly logger = new Logger(BetsService.name);
  private BetPlacedEvent!: protobuf.Type;
  private BetSettledEvent!: protobuf.Type;
  private TransactionConfirmedEvent!: protobuf.Type;

  constructor(
    @InjectRepository(Bet) private readonly repo: Repository<Bet>,
    private readonly redis: RedisService,
    private readonly gateway: EventsGateway,
  ) {}

  async onModuleInit() {
    const root = await protobuf.load(path.join('/proto', 'events.proto'));
    this.BetPlacedEvent = root.lookupType('betting.events.BetPlacedEvent');
    this.BetSettledEvent = root.lookupType('betting.events.BetSettledEvent');
    this.TransactionConfirmedEvent = root.lookupType('betting.events.TransactionConfirmedEvent');
    this.subscribeToTransactionConfirmed();
  }

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

    const msg = this.BetPlacedEvent.create({
      betId: bet.id,
      userId,
      eventId,
      selection,
      odds,
      stake,
      placedAt: Date.now(),
    });
    await this.redis.publish('bet.placed', this.BetPlacedEvent.encode(msg).finish() as Buffer);
    return bet;
  }

  async settle(betId: string, won: boolean, payout: number): Promise<void> {
    await this.repo.update(betId, {
      status: won ? 'won' : 'lost',
      payout: won ? payout : 0,
    });
    const bet = await this.repo.findOneByOrFail({ id: betId });

    const msg = this.BetSettledEvent.create({
      betId,
      userId: bet.userId,
      won,
      payout,
      settledAt: Date.now(),
    });
    await this.redis.publish('bet.settled', this.BetSettledEvent.encode(msg).finish() as Buffer);
    this.gateway.sendToUser(bet.userId, 'bet.settled', { betId, won, payout });
  }

  findByUser(userId: string) {
    return this.repo.find({ where: { userId }, order: { placedAt: 'DESC' } });
  }

  private subscribeToTransactionConfirmed() {
    this.redis.subscribe('tx.confirmed', async (raw) => {
      try {
        const event = this.TransactionConfirmedEvent.decode(raw);
        const { betId, userId, type } = event as any;
        if (type === 'hold') {
          await this.repo.update(betId, { status: 'held' });
          this.gateway.sendToUser(userId, 'bet.held', { betId });
        }
      } catch (e) {
        this.logger.error('Failed to decode tx.confirmed', e);
      }
    });
  }
}
