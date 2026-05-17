import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { KeycloakModule } from './keycloak/keycloak.module';
import { KeycloakAuthModule } from './keycloak/keycloak-auth.module';
import { UsersModule } from './users/users.module';
import { BetsModule } from './bets/bets.module';
import { WalletModule } from './wallet/wallet.module';
import { OddsModule } from './odds/odds.module';
import { RedisModule } from './redis/redis.module';
import { AdminModule } from './admin/admin.module';
import { User } from './users/user.entity';
import { Bet } from './bets/bet.entity';
import { LoggingMiddleware } from './common/logging.middleware';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        type: 'postgres',
        url: config.get('DATABASE_URL'),
        entities: [User, Bet],
        synchronize: true, // use migrations in production
      }),
    }),
    RedisModule,
    KeycloakModule,
    UsersModule,
    KeycloakAuthModule,
    BetsModule,
    WalletModule,
    OddsModule,
    AdminModule,
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(LoggingMiddleware).forRoutes('*');
  }
}
