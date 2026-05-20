import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { EventResolvedEvent, Outcome } from '../generated/events';
import { MessagingService } from '../messaging/messaging.service';
import { Bet } from '../bets/bet.entity';
import { BetsService } from '../bets/bets.service';
import { EventResult, EventOutcome } from './event-result.entity';

const OUTCOME_MAP: Record<Outcome, EventOutcome | null> = {
  [Outcome.UNSPECIFIED]: null,
  [Outcome.HOME]: 'home',
  [Outcome.AWAY]: 'away',
  [Outcome.DRAW]: 'draw',
};

@Injectable()
export class EventsService implements OnModuleInit {
  private readonly logger = new Logger(EventsService.name);

  constructor(
    private readonly messaging: MessagingService,
    @InjectRepository(EventResult)
    private readonly results: Repository<EventResult>,
    @InjectRepository(Bet)
    private readonly bets: Repository<Bet>,
    private readonly betsService: BetsService,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.messaging.subscribe(
      'events.resolved',
      (raw) => this.handle(raw),
      { durable: true, queueName: 'core.events.resolved' },
    );
  }

  async handle(raw: Buffer): Promise<void> {
    const event = EventResolvedEvent.fromBinary(raw);
    const outcome = OUTCOME_MAP[event.outcome];
    if (outcome === null) {
      this.logger.warn(`Ignoring events.resolved for ${event.eventId} with unspecified outcome`);
      return;
    }

    const inserted = await this.results
      .createQueryBuilder()
      .insert()
      .values({ eventId: event.eventId, outcome })
      .orIgnore()
      .execute();

    if (inserted.identifiers.length === 0) {
      this.logger.log(`Event ${event.eventId} already resolved, skipping`);
      return;
    }

    const held = await this.bets.find({
      where: { eventId: event.eventId, status: 'held' },
    });
    this.logger.log(`Settling ${held.length} held bet(s) on event ${event.eventId} (${outcome})`);

    for (const bet of held) {
      const won = bet.selection === outcome;
      const stake = Number(bet.stake);
      const odds = Number(bet.odds);
      const profit = won ? stake * (odds - 1) : 0;
      await this.betsService.settle(bet.id, won, profit);
    }
  }
}
