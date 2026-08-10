import { Module } from "@nestjs/common";
import { OddsCacheService } from "./odds-cache.service";

@Module({
  providers: [OddsCacheService],
  exports: [OddsCacheService],
})
export class OddsModule {}
