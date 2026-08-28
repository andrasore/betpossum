import { Module } from "@nestjs/common";
import { PublisherModule } from "../publisher/publisher.module";
import { StorageModule } from "../storage/storage.module";
import { OddsController } from "./odds.controller";

@Module({
  imports: [StorageModule, PublisherModule],
  controllers: [OddsController],
})
export class OddsModule {}
