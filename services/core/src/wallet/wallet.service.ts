import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import { v4 as uuidv4 } from 'uuid';
import { BalanceRequestEvent, BalanceResponseEvent, BalanceUpdatedEvent } from '../generated/events';
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

  async getBalance(userId: string): Promise<number> {
    const replyTo = `balance.response.${uuidv4()}`;
    const responsePromise = this.redis.subscribeOnce(replyTo);
    const req = BalanceRequestEvent.create({ userId, replyTo });
    await this.redis.publish('balance.request', Buffer.from(BalanceRequestEvent.toBinary(req)));
    const raw = await responsePromise;
    const res = BalanceResponseEvent.fromBinary(raw);
    return res.balance;
  }
}
