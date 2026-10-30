const MINUTE_MS = 60 * 1000;

/** An SMS code: 6 digits, valid 10 minutes, dead after 5 wrong tries. */
export const CODE_LENGTH = 6;
export const CODE_TTL_MS = 10 * MINUTE_MS;
export const CODE_MAX_ATTEMPTS = 5;

/**
 * SMS sending per phone: at most one code per minute, 5 per hour, and 10 per
 * rolling 24 hours. With 5 tries per code, the daily cap bounds guessing to 50
 * tries a day (F-14).
 */
export const CODE_COOLDOWN_MS = MINUTE_MS;
export const CODES_PER_HOUR = 5;
export const CODES_PER_DAY = 10;

/** The single-use token a verified code turns into, to set or check the PIN. */
export const VERIFICATION_TTL_MS = 10 * MINUTE_MS;

/** Mobile sessions: a 30-day refresh token, rotated at each use. */
export const REFRESH_TOKEN_TTL_MS = 30 * 24 * 60 * MINUTE_MS;

/** How long a user stays locked after `maxPinAttempts` wrong PINs. */
export const PIN_LOCK_DURATION_MS = 15 * MINUTE_MS;

/** Recovery with security answers: 3 wrong tries lock it for 24 hours. */
export const RECOVERY_MAX_ATTEMPTS = 3;
export const RECOVERY_LOCK_DURATION_MS = 24 * 60 * MINUTE_MS;

/** A login challenge: signed by the device, single-use, valid 2 minutes. */
export const CHALLENGE_TTL_MS = 2 * MINUTE_MS;
