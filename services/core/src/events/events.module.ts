import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BetsModule } from '../bets/bets.module';
import { Bet } from '../bets/bet.entity';
import { EventResult } from './event-result.entity';
import { EventsService } from './events.service';

@Module({
  imports: [TypeOrmModule.forFeature([EventResult, Bet]), BetsModule],
  providers: [EventsService],
})
export class EventsModule {}
