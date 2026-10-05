import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { hashToken } from './secrets.js';

export interface AccessTokenClaims {
  /** Admin id. */
  sub: string;
  /** Session id. */
  sid: string;
}

export interface NewRefreshToken {
  /** Sent to the browser in the refresh cookie. */
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

  newRefreshSecret(): NewRefreshToken {
    const secret = randomBytes(32).toString('base64url');
    return { secret, hash: hashToken(secret) };
  }

  /** The cookie value: the session id tells us which row to check. */
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
