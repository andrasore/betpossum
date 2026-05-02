import { Module } from '@nestjs/common';
import { OddsService } from './odds.service';
import { EventsModule } from '../events/events.module';

@Module({
  imports: [EventsModule],
  providers: [OddsService],
  exports: [OddsService],
})
export class OddsModule {}
