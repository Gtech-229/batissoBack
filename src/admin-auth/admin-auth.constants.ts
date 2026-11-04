export const ACCESS_COOKIE = 'batisso_admin_access';
export const REFRESH_COOKIE = 'batisso_admin_refresh';

export const ACCESS_TOKEN_TTL_SECONDS = 15 * 60;
export const REFRESH_TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const LOCK_DURATION_MS = 15 * 60 * 1000;

/** Life of an emailed password link (feature 22): 3 days for now. */
export const PASSWORD_TOKEN_TTL_MS = 3 * 24 * 60 * 60 * 1000;
/** At most one password email a minute per admin. */
export const PASSWORD_LINK_COOLDOWN_MS = 60 * 1000;

/** The refresh cookie is only sent to the auth routes, never to the rest of the API. */
export const ACCESS_COOKIE_PATH = '/api/v1';
export const REFRESH_COOKIE_PATH = '/api/v1/admin/auth';
