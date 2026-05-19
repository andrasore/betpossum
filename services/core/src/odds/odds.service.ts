import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { OddsUpdatedEvent } from '../generated/events';
import { NotificationsClient } from '../notifications/notifications.client';
import { RedisService } from '../redis/redis.service';
import { OddsCurrent } from './odds-current.entity';

@Injectable()
export class OddsService implements OnModuleInit {
  private readonly logger = new Logger(OddsService.name);

  constructor(
    private readonly redis: RedisService,
    private readonly notifications: NotificationsClient,
    @InjectRepository(OddsCurrent)
    private readonly repo: Repository<OddsCurrent>,
  ) {}

  onModuleInit() {
    this.redis.subscribe('odds.updated', async (raw) => {
      try {
        const event = OddsUpdatedEvent.fromBinary(raw);
        await this.notifications.broadcast('odds.updated', event);
      } catch (e) {
        this.logger.error('Failed to decode odds.updated', e);
      }
    });
  }

  getOdds(eventId: string): Promise<OddsCurrent | null> {
    return this.repo.findOneBy({ eventId });
  }

  listOdds(sport?: string): Promise<OddsCurrent[]> {
    return this.repo.find({
      where: sport ? { sport } : {},
      order: { updatedAt: 'DESC' },
    });
  }
}
