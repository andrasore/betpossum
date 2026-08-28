import {
  type MiddlewareConsumer,
  Module,
  type NestModule,
} from "@nestjs/common";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { TypeOrmModule } from "@nestjs/typeorm";
import { AuthModule } from "./auth/auth.module";
import { LoggingMiddleware } from "./common/logging.middleware";
import { HealthController } from "./health/health.controller";
import { MessagingModule } from "./messaging/messaging.module";
import { StatsModule } from "./stats/stats.module";
import { Settlement } from "./storage/settlement.entity";

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        type: "postgres" as const,
        url: config.get("DATABASE_URL"),
        // The read model lives in its own schema of the shared `betting` DB
        // (infra's init.sh creates it; main.ts self-provisions defensively).
        // Unset (tests) falls back to `public`.
        schema: config.get("DB_SCHEMA") || undefined,
        entities: [Settlement],
        synchronize: true, // use migrations in production
      }),
    }),
    MessagingModule,
    AuthModule,
    StatsModule,
  ],
  controllers: [HealthController],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(LoggingMiddleware).forRoutes("*");
  }
}
