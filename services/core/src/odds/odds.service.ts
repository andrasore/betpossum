import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { OddsUpdatedEvent } from '../generated/events';
import { NotificationsClient } from '../notifications/notifications.client';
import { RedisService } from '../redis/redis.service';

@Injectable()
export class OddsService implements OnModuleInit {
  private readonly logger = new Logger(OddsService.name);

  constructor(
    private readonly redis: RedisService,
    private readonly notifications: NotificationsClient,
  ) {}

  onModuleInit() {
    this.redis.subscribe('odds.updated', async (raw) => {
      try {
        const event = OddsUpdatedEvent.fromBinary(raw);
        await this.redis.pub.set(`odds:${event.eventId}`, JSON.stringify(event));
        await this.notifications.broadcast('odds.updated', event);
      } catch (e) {
        this.logger.error('Failed to decode odds.updated', e);
      }
    });
  }

  async getOdds(eventId: string) {
    const raw = await this.redis.pub.get(`odds:${eventId}`);
    return raw ? JSON.parse(raw) : null;
  }
}
