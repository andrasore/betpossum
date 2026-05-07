import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { BetsModule } from './bets/bets.module';
import { WalletModule } from './wallet/wallet.module';
import { OddsModule } from './odds/odds.module';
import { EventsModule } from './events/events.module';
import { RedisModule } from './redis/redis.module';
import { User } from './users/user.entity';
import { Bet } from './bets/bet.entity';

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
    UsersModule,
    AuthModule,
    BetsModule,
    WalletModule,
    OddsModule,
    EventsModule,
  ],
})
export class AppModule {}
