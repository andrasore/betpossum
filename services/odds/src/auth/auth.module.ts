import { Module } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { PassportModule } from "@nestjs/passport";
import { JwtAuthGuard } from "../common/jwt-auth.guard";
import { JwtStrategy } from "./jwt.strategy";

// Authenticated by default; `@Public()` opts a route out (/health and the
// leaderboard).
@Module({
  imports: [PassportModule],
  providers: [JwtStrategy, { provide: APP_GUARD, useClass: JwtAuthGuard }],
})
export class AuthModule {}
