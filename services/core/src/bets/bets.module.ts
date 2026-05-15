import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Bet } from './bet.entity';
import { BetsService } from './bets.service';
import { BetsController } from './bets.controller';
import { EventsModule } from '../events/events.module';
import { WalletModule } from '../wallet/wallet.module';

@Module({
  imports: [TypeOrmModule.forFeature([Bet]), EventsModule, WalletModule],
  providers: [BetsService],
  controllers: [BetsController],
  exports: [BetsService],
})
export class BetsModule {}
