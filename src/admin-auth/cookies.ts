import type { CookieOptions, Response } from 'express';
import {
  ACCESS_COOKIE,
  ACCESS_COOKIE_PATH,
  ACCESS_TOKEN_TTL_SECONDS,
  REFRESH_COOKIE,
  REFRESH_COOKIE_PATH,
  REFRESH_TOKEN_TTL_MS,
} from './admin-auth.constants.js';

export interface SessionCookies {
  accessToken: string;
  refreshToken: string;
}

function baseOptions(secure: boolean): CookieOptions {
  // httpOnly: page scripts cannot read the tokens (XSS cannot steal them).
  // sameSite lax: the browser does not send them on cross-site POSTs (CSRF).
  return { httpOnly: true, sameSite: 'lax', secure };
}

export function setSessionCookies(
  res: Response,
  cookies: SessionCookies,
  secure: boolean,
): void {
  res.cookie(ACCESS_COOKIE, cookies.accessToken, {
    ...baseOptions(secure),
    path: ACCESS_COOKIE_PATH,
    maxAge: ACCESS_TOKEN_TTL_SECONDS * 1000,
  });
  res.cookie(REFRESH_COOKIE, cookies.refreshToken, {
    ...baseOptions(secure),
    path: REFRESH_COOKIE_PATH,
    maxAge: REFRESH_TOKEN_TTL_MS,
  });
}

export function clearSessionCookies(res: Response, secure: boolean): void {
  // A cookie is only cleared with the same path it was set with.
  res.clearCookie(ACCESS_COOKIE, {
    ...baseOptions(secure),
    path: ACCESS_COOKIE_PATH,
  });
  res.clearCookie(REFRESH_COOKIE, {
    ...baseOptions(secure),
    path: REFRESH_COOKIE_PATH,
  });
}
