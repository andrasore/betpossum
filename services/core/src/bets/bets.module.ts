import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { NotificationsModule } from "../notifications/notifications.module";
import { UsersModule } from "../users/users.module";
import { WalletModule } from "../wallet/wallet.module";
import { Bet } from "./bet.entity";
import { BetsController } from "./bets.controller";
import { BetsService } from "./bets.service";

@Module({
  imports: [
    TypeOrmModule.forFeature([Bet]),
    NotificationsModule,
    UsersModule,
    WalletModule,
  ],
  providers: [BetsService],
  controllers: [BetsController],
  exports: [BetsService],
})
export class BetsModule {}
