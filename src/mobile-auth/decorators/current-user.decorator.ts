import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';
import type { AuthenticatedUser } from '../authenticated-user.js';

/** Injects the mobile user the guard authenticated: `@CurrentUser() user: AuthenticatedUser`. */
export const CurrentUser = createParamDecorator(
  (_data: unknown, context: ExecutionContext): AuthenticatedUser => {
    const user = context.switchToHttp().getRequest<Request>().mobileUser;
    if (!user) {
      // Only reachable on a route without the mobile guard: a programming error.
      throw new Error(
        '@CurrentUser() used on a route without the mobile guard',
      );
    }
    return user;
  },
);
