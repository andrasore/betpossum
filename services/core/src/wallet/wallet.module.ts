import { Module } from '@nestjs/common';
import { WalletService } from './wallet.service';
import { EventsModule } from '../events/events.module';

@Module({
  imports: [EventsModule],
  providers: [WalletService],
  exports: [WalletService],
})
export class WalletModule {}
