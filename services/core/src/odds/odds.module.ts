import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { NotificationsModule } from "../notifications/notifications.module";
import { OddsController } from "./odds.controller";
import { OddsService } from "./odds.service";
import { OddsCurrent } from "./odds-current.entity";

@Module({
  imports: [TypeOrmModule.forFeature([OddsCurrent]), NotificationsModule],
  controllers: [OddsController],
  providers: [OddsService],
  exports: [OddsService],
})
export class OddsModule {}
