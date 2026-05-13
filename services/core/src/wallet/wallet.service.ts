import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import { BalanceUpdatedEvent } from '../generated/events';
import { RedisService } from '../redis/redis.service';
import { EventsGateway } from '../events/events.gateway';

@Injectable()
export class WalletService implements OnModuleInit {
  private readonly logger = new Logger(WalletService.name);

  constructor(
    private readonly redis: RedisService,
    private readonly gateway: EventsGateway,
  ) {}

  onModuleInit() {
    this.redis.subscribe('balance.updated', (raw) => {
      try {
        const event = BalanceUpdatedEvent.fromBinary(raw);
        this.gateway.sendToUser(event.userId, 'balance.updated', { balance: event.balance });
      } catch (e) {
        this.logger.error('Failed to decode balance.updated', e);
      }
    });
  }
}
