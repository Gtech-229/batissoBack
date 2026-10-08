import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { hashToken } from './secrets.js';

export interface AccessTokenClaims {
  /** Admin id, or user id in a mobile token. */
  sub: string;
  /** Session id. */
  sid: string;
}

/**
 * Marks a mobile access token. The mobile guard requires it, so an admin token
 * can never pass as a mobile one; the admin guard finds no admin session for a
 * mobile token's session id either.
 */
export const USER_TOKEN_TYPE = 'user';

export interface NewRefreshToken {
  /** Sent to the client (refresh cookie, or the mobile app's storage). */
  secret: string;
  /** Stored on the session row instead of the secret. */
  hash: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

@Injectable()
export class TokensService {
  constructor(private readonly jwt: JwtService) {}

  signAccessToken(claims: AccessTokenClaims): Promise<string> {
    return this.jwt.signAsync({ sub: claims.sub, sid: claims.sid });
  }

  /** Same secret and lifetime as the admin token, plus `typ: 'user'`. */
  signUserAccessToken(claims: AccessTokenClaims): Promise<string> {
    return this.jwt.signAsync({
      sub: claims.sub,
      sid: claims.sid,
      typ: USER_TOKEN_TYPE,
    });
  }

  /**
   * The claims of a valid mobile access token, or null: expired, tampered,
   * signed with another secret, or not a mobile token (an admin token has no
   * `typ`).
   */
  async verifyUserAccessToken(
    token: string,
  ): Promise<AccessTokenClaims | null> {
    try {
      const claims = await this.jwt.verifyAsync<
        Partial<AccessTokenClaims> & { typ?: unknown }
      >(token);
      if (
        claims.typ !== USER_TOKEN_TYPE ||
        typeof claims.sub !== 'string' ||
        typeof claims.sid !== 'string'
      ) {
        return null;
      }
      return { sub: claims.sub, sid: claims.sid };
    } catch {
      return null;
    }
  }

  newRefreshSecret(): NewRefreshToken {
    const secret = randomBytes(32).toString('base64url');
    return { secret, hash: hashToken(secret) };
  }

  /** The refresh token: the session id tells us which row to check. */
  formatRefreshToken(sessionId: string, secret: string): string {
    return `${sessionId}.${secret}`;
  }

  parseRefreshToken(
    token: unknown,
  ): { sessionId: string; secret: string } | null {
    if (typeof token !== 'string') {
      return null;
    }
    const [sessionId, secret, ...rest] = token.split('.');
    if (rest.length > 0 || !UUID.test(sessionId ?? '') || !secret) {
      return null;
    }
    return { sessionId, secret };
  }

  secretMatches(secret: string, storedHash: string): boolean {
    const actual = Buffer.from(hashToken(secret), 'hex');
    const expected = Buffer.from(storedHash, 'hex');
    return (
      actual.length === expected.length && timingSafeEqual(actual, expected)
    );
  }
}
