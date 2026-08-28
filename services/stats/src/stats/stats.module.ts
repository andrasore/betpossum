import { Module } from "@nestjs/common";
import { StorageModule } from "../storage/storage.module";
import { SettlementsConsumer } from "./settlements.consumer";
import { StatsController } from "./stats.controller";

@Module({
  imports: [StorageModule],
  controllers: [StatsController],
  providers: [SettlementsConsumer],
})
export class StatsModule {}
