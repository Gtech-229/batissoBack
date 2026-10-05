import type { AdminRole } from '../generated/prisma/client.js';

/** What the guard knows about the caller, stored on `request.admin`. */
export interface AuthenticatedAdmin {
  adminId: string;
  sessionId: string;
  role: AdminRole;
}

declare module 'express-serve-static-core' {
  interface Request {
    /** Set by AdminAuthGuard on every protected route. */
    admin?: AuthenticatedAdmin;
  }
}
