import { Module } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { PassportModule } from "@nestjs/passport";
import { JwtAuthGuard } from "../common/jwt-auth.guard";
import { UsersModule } from "../users/users.module";
import { JwtStrategy } from "./jwt.strategy";
import { KeycloakModule } from "./keycloak.module";

@Module({
  imports: [PassportModule, KeycloakModule, UsersModule],
  providers: [
    JwtStrategy,
    { provide: APP_GUARD, useClass: JwtAuthGuard },
  ],
})
export class KeycloakAuthModule {}
