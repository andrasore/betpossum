import { Module } from '@nestjs/common';
import { RedisModule } from '../redis/redis.module';
import { NotificationsClient } from './notifications.client';

@Module({
  imports: [RedisModule],
  providers: [NotificationsClient],
  exports: [NotificationsClient],
})
export class NotificationsModule {}
