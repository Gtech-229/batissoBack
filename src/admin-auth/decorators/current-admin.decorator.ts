import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';
import type { AuthenticatedAdmin } from '../authenticated-admin.js';

/** Injects the admin the guard authenticated: `@CurrentAdmin() admin: AuthenticatedAdmin`. */
export const CurrentAdmin = createParamDecorator(
  (_data: unknown, context: ExecutionContext): AuthenticatedAdmin => {
    const admin = context.switchToHttp().getRequest<Request>().admin;
    if (!admin) {
      // Only reachable if the route is @Public(): a programming error.
      throw new Error(
        '@CurrentAdmin() used on a route without the admin guard',
      );
    }
    return admin;
  },
);
