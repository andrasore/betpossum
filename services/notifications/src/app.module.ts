import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { HealthController } from "./health/health.controller";
import { MessagingModule } from "./messaging/messaging.module";
import { RelayModule } from "./relay/relay.module";

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    MessagingModule,
    RelayModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
