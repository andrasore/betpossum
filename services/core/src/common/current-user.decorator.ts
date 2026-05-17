import { ExecutionContext, createParamDecorator } from '@nestjs/common';
import type { Request } from 'express';
import { User } from '../users/user.entity';

export type AuthUser = User & { roles: string[] };

export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthUser => {
    const req = ctx.switchToHttp().getRequest<Request & { user?: AuthUser }>();
    if (!req.user) {
      throw new Error('CurrentUser used on a route without an auth guard');
    }
    return req.user;
  },
);
