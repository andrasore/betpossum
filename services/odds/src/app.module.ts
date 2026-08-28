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
import { OddsModule } from "./odds/odds.module";
import { ProvidersModule } from "./providers/providers.module";
import { RunnerModule } from "./runner/runner.module";
import { ODDS_ENTITIES } from "./storage/entities";

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const schema = config.get<string>("DB_SCHEMA") || undefined;
        return {
          type: "postgres" as const,
          url: config.get("DATABASE_URL"),
          // Odds owns its own schema of the shared `betting` DB (infra's
          // init.sh creates it; main.ts self-provisions defensively). Unset
          // (tests) falls back to `public`.
          schema,
          // TypeORM qualifies its own SQL with the schema, but the entity
          // resolver's raw ON CONFLICT ... RETURNING statements use bare table
          // names — so pin the session search_path too.
          extra: schema ? { options: `-c search_path=${schema}` } : undefined,
          entities: ODDS_ENTITIES,
          synchronize: true, // use migrations in production
        };
      },
    }),
    MessagingModule,
    AuthModule,
    ProvidersModule,
    OddsModule,
    RunnerModule,
  ],
  controllers: [HealthController],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(LoggingMiddleware).forRoutes("*");
  }
}
