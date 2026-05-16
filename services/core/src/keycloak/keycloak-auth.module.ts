import { Module } from '@nestjs/common';
import { PassportModule } from '@nestjs/passport';
import { UsersModule } from '../users/users.module';
import { KeycloakModule } from './keycloak.module';
import { JwtStrategy } from './jwt.strategy';

@Module({
  imports: [PassportModule, KeycloakModule, UsersModule],
  providers: [JwtStrategy],
})
export class KeycloakAuthModule {}
