import {
  type MiddlewareConsumer,
  Module,
  type NestModule,
} from "@nestjs/common";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { TypeOrmModule } from "@nestjs/typeorm";
import { AdminModule } from "./admin/admin.module";
import { Bet } from "./bets/bet.entity";
import { BetsModule } from "./bets/bets.module";
import { LoggingMiddleware } from "./common/logging.middleware";
import { KeycloakModule } from "./keycloak/keycloak.module";
import { KeycloakAuthModule } from "./keycloak/keycloak-auth.module";
import { MessagingModule } from "./messaging/messaging.module";
import { User } from "./users/user.entity";
import { UsersModule } from "./users/users.module";
import { WalletModule } from "./wallet/wallet.module";

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        type: "postgres",
        url: config.get("DATABASE_URL"),
        entities: [User, Bet],
        synchronize: true, // use migrations in production
      }),
    }),
    MessagingModule,
    KeycloakModule,
    UsersModule,
    KeycloakAuthModule,
    BetsModule,
    WalletModule,
    AdminModule,
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(LoggingMiddleware).forRoutes("*");
  }
}
