import { Module } from '@nestjs/common';
import { OddsService } from './odds.service';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [NotificationsModule],
  providers: [OddsService],
  exports: [OddsService],
})
export class OddsModule {}
