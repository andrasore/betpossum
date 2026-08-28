import { Module } from "@nestjs/common";
import { OddsPublisher } from "./odds.publisher";

@Module({
  providers: [OddsPublisher],
  exports: [OddsPublisher],
})
export class PublisherModule {}
