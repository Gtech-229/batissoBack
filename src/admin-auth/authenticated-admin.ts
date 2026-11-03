import type { AdminRole } from '../generated/prisma/client.js';
import type { Permission } from './permissions.js';

/** What the guard knows about the caller, stored on `request.admin`. */
export interface AuthenticatedAdmin {
  adminId: string;
  sessionId: string;
  role: AdminRole;
  /** What this admin may do now: every permission for the super admin. */
  permissions: Permission[];
}

declare module 'express-serve-static-core' {
  interface Request {
    /** Set by AdminAuthGuard on every protected route. */
    admin?: AuthenticatedAdmin;
  }
}
