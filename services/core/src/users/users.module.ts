import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { User } from './user.entity';
import { UsersService } from './users.service';
import { KeycloakModule } from '../keycloak/keycloak.module';

@Module({
  imports: [TypeOrmModule.forFeature([User]), KeycloakModule],
  providers: [UsersService],
  exports: [UsersService],
})
export class UsersModule {}
