import { createParamDecorator, type ExecutionContext } from "@nestjs/common";
import type { Request } from "express";
import type { User } from "../users/user.entity";

export type AuthUser = User & { roles: string[] };

export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthUser => {
    const req = ctx.switchToHttp().getRequest<Request>();
    if (!req.user) {
      throw new Error("CurrentUser used on a route without an auth guard");
    }
    return req.user;
  },
);
