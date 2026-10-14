/** What the mobile guard knows about the caller, stored on `request.mobileUser`. */
export interface AuthenticatedUser {
  userId: string;
  sessionId: string;
  /** The app's id of the session's device (not a secret, not a proof). */
  deviceId: string;
}

declare module 'express-serve-static-core' {
  interface Request {
    /** Set by UserAuthGuard on every protected mobile route. */
    mobileUser?: AuthenticatedUser;
  }
}
