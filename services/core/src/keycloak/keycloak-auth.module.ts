import { Module } from "@nestjs/common";
import { PassportModule } from "@nestjs/passport";
import { UsersModule } from "../users/users.module";
import { JwtStrategy } from "./jwt.strategy";
import { KeycloakModule } from "./keycloak.module";

@Module({
  imports: [PassportModule, KeycloakModule, UsersModule],
  providers: [JwtStrategy],
})
export class KeycloakAuthModule {}
