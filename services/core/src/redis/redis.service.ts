import { Injectable, OnModuleDestroy, OnModuleInit, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  readonly pub: Redis;
  readonly sub: Redis;

  constructor(private readonly config: ConfigService) {
    const url = this.config.get<string>('REDIS_URL', 'redis://localhost:6379');
    this.pub = new Redis(url);
    this.sub = new Redis(url);
  }

  onModuleInit() {
    this.pub.on('error', (e) => this.logger.error('Redis pub error', e));
    this.sub.on('error', (e) => this.logger.error('Redis sub error', e));
  }

  async onModuleDestroy() {
    await Promise.all([this.pub.quit(), this.sub.quit()]);
  }

  async publish(channel: string, payload: Buffer): Promise<void> {
    await this.pub.publish(channel, payload as unknown as string);
  }

  subscribe(channel: string, handler: (msg: Buffer) => void): void {
    this.sub.subscribe(channel);
    this.sub.on('messageBuffer', (ch: Buffer, msg: Buffer) => {
      if (ch.toString() === channel) handler(msg);
    });
  }
}
