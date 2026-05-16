import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { passportJwtSecret } from 'jwks-rsa';
import { UsersService } from '../users/users.service';
import { KeycloakService } from './keycloak.service';

export interface KeycloakJwtPayload {
  sub: string;
  email?: string;
  preferred_username?: string;
  name?: string;
  given_name?: string;
  family_name?: string;
  realm_access?: { roles?: string[] };
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    keycloak: KeycloakService,
    private readonly users: UsersService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      issuer: keycloak.issuerUrl,
      algorithms: ['RS256'],
      secretOrKeyProvider: passportJwtSecret({
        jwksUri: keycloak.jwksUri,
        cache: true,
        rateLimit: true,
      }),
    });
  }

  async validate(payload: KeycloakJwtPayload) {
    if (!payload?.sub) throw new UnauthorizedException();
    const user = await this.users.ensureFromJwt(payload);
    return {
      ...user,
      roles: payload.realm_access?.roles ?? [],
    };
  }
}
