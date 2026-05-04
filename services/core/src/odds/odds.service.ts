import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { OddsUpdatedEvent } from '../generated/events.pb';
import { RedisService } from '../redis/redis.service';
import { EventsGateway } from '../events/events.gateway';

@Injectable()
export class OddsService implements OnModuleInit {
  private readonly logger = new Logger(OddsService.name);

  constructor(
    private readonly redis: RedisService,
    private readonly gateway: EventsGateway,
  ) {}

  onModuleInit() {
    this.redis.subscribe('odds.updated', (raw) => {
      try {
        const event = OddsUpdatedEvent.fromBinary(raw);
        this.redis.pub.set(`odds:${event.eventId}`, JSON.stringify(event));
        this.gateway.broadcast('odds.updated', event);
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
