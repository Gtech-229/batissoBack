import type {
  StoreMemberRole,
  StoreStatus,
} from '../generated/prisma/client.js';

/** What StoreAccessGuard knows about the caller in the URL's store. */
export interface CurrentStoreContext {
  storeId: string;
  role: StoreMemberRole;
  storeStatus: StoreStatus;
}

declare module 'express-serve-static-core' {
  interface Request {
    /** Set by StoreAccessGuard on every route with `StoreRoles`. */
    storeMember?: CurrentStoreContext;
  }
}
