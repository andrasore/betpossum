import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import jwt from "jsonwebtoken";
import { JwksClient } from "jwks-rsa";

export interface VerifiedToken {
  sub: string;
}

/**
 * Keycloak bearer verification for the socket handshake.
 *
 * Note the URL split, same as core and the other services: the JWKS is fetched
 * over the *internal* Keycloak URL (backchannel, bypasses nginx) while the `iss`
 * claim is checked against the *browser-facing* issuer, which is what the token
 * actually carries. Audience is deliberately not verified.
 */
@Injectable()
export class TokenVerifierService {
  private readonly logger = new Logger(TokenVerifierService.name);
  private readonly issuer: string;
  private readonly jwks: JwksClient;

  constructor(config: ConfigService) {
    const internalUrl = config.get<string>(
      "KEYCLOAK_INTERNAL_URL",
      "http://keycloak:8080",
    );
    const realm = config.get<string>("KEYCLOAK_REALM", "betting");
    this.issuer = config.get<string>(
      "KEYCLOAK_ISSUER_URL",
      `${internalUrl}/realms/${realm}`,
    );
    this.jwks = new JwksClient({
      jwksUri: `${internalUrl}/realms/${realm}/protocol/openid-connect/certs`,
      cache: true,
      rateLimit: true,
    });
  }

  /** Resolves the `sub` of a valid token, or null for any invalid one. */
  async verify(token: unknown): Promise<VerifiedToken | null> {
    if (typeof token !== "string" || !token) {
      return null;
    }
    try {
      const payload = await new Promise<jwt.JwtPayload>((resolve, reject) => {
        jwt.verify(
          token,
          (header, callback) => {
            this.jwks
              .getSigningKey(header.kid)
              .then((key) => callback(null, key.getPublicKey()))
              .catch(callback);
          },
          { algorithms: ["RS256"], issuer: this.issuer },
          (err, decoded) => {
            if (err || !decoded || typeof decoded === "string") {
              reject(err ?? new Error("malformed token payload"));
              return;
            }
            resolve(decoded);
          },
        );
      });
      const sub = payload.sub;
      return typeof sub === "string" && sub ? { sub } : null;
    } catch (err) {
      this.logger.log(`Rejecting token: ${String(err)}`);
      return null;
    }
  }
}
