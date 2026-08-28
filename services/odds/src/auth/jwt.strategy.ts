import { Injectable, UnauthorizedException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { PassportStrategy } from "@nestjs/passport";
import { passportJwtSecret } from "jwks-rsa";
import { ExtractJwt, Strategy } from "passport-jwt";
import type { AuthUser } from "../common/current-user.decorator";

export interface KeycloakJwtPayload {
  sub: string;
  realm_access?: { roles?: string[] };
}

/**
 * Keycloak bearer verification.
 *
 * Note the URL split: the JWKS is fetched over the *internal* Keycloak URL
 * (backchannel, bypasses nginx) while the `iss` claim is checked against the
 * *browser-facing* issuer, which is what the token actually carries. Audience
 * is deliberately not verified.
 */
@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(config: ConfigService) {
    const internalUrl = config.get<string>(
      "KEYCLOAK_INTERNAL_URL",
      "http://keycloak:8080",
    );
    const realm = config.get<string>("KEYCLOAK_REALM", "betting");
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      issuer: config.get<string>(
        "KEYCLOAK_ISSUER_URL",
        `${internalUrl}/realms/${realm}`,
      ),
      algorithms: ["RS256"],
      secretOrKeyProvider: passportJwtSecret({
        jwksUri: `${internalUrl}/realms/${realm}/protocol/openid-connect/certs`,
        cache: true,
        rateLimit: true,
      }),
    });
  }

  validate(payload: KeycloakJwtPayload): AuthUser {
    if (!payload?.sub) {
      throw new UnauthorizedException();
    }
    return { sub: payload.sub, roles: payload.realm_access?.roles ?? [] };
  }
}
