import { createParamDecorator, type ExecutionContext } from "@nestjs/common";
import type { Request } from "express";

/**
 * The caller's identity, as verified from the Keycloak token. Unlike core there
 * is no local user row — stats never reads another service's tables, so the
 * claims are all there is.
 */
export interface AuthUser {
  sub: string;
  roles: string[];
}

export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthUser => {
    const req = ctx.switchToHttp().getRequest<Request>();
    const user = req.user as AuthUser | undefined;
    if (!user) {
      throw new Error("CurrentUser used on a route without an auth guard");
    }
    return user;
  },
);
