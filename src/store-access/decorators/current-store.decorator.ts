import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';
import type { CurrentStoreContext } from '../current-store.js';

/** Injects the store context the guard set: `@CurrentStore() store: CurrentStoreContext`. */
export const CurrentStore = createParamDecorator(
  (_data: unknown, context: ExecutionContext): CurrentStoreContext => {
    const store = context.switchToHttp().getRequest<Request>().storeMember;
    if (!store) {
      // Only reachable on a route without StoreRoles: a programming error.
      throw new Error('@CurrentStore() used on a route without StoreRoles');
    }
    return store;
  },
);
