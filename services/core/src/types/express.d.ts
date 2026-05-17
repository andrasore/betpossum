import type { AuthUser } from '../common/current-user.decorator';

declare global {
  namespace Express {
    interface User extends AuthUser {}
  }
}

export {};
