import { JwtService } from '@nestjs/jwt';
import { hashToken } from './secrets.js';
import { TokensService } from './tokens.service.js';

const SESSION_ID = '0192f0a4-7b1c-7c3e-9d2a-5e6f7a8b9c0d';
const SECRET = 'x'.repeat(32);

function service() {
  const jwt = new JwtService({
    secret: SECRET,
    signOptions: { algorithm: 'HS256', expiresIn: 900 },
  });
  return { jwt, tokens: new TokensService(jwt) };
}

describe('TokensService', () => {
  it('signs an access token with the admin and session ids and a 15 min expiry', async () => {
    const { jwt, tokens } = service();

    const token = await tokens.signAccessToken({
      sub: 'admin-1',
      sid: SESSION_ID,
    });
    const claims =
      await jwt.verifyAsync<Record<string, number | string>>(token);

    expect(claims.sub).toBe('admin-1');
    expect(claims.sid).toBe(SESSION_ID);
    expect(Number(claims.exp) - Number(claims.iat)).toBe(900);
  });

  it('creates a random refresh secret and stores only its hash', () => {
    const { tokens } = service();

    const first = tokens.newRefreshSecret();
    const second = tokens.newRefreshSecret();

    expect(first.secret).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(first.hash).toBe(hashToken(first.secret));
    expect(first.secret).not.toBe(second.secret);
  });

  it('formats and parses a refresh token', () => {
    const { tokens } = service();
    const token = tokens.formatRefreshToken(SESSION_ID, 'abc_DEF-123');

    expect(tokens.parseRefreshToken(token)).toEqual({
      sessionId: SESSION_ID,
      secret: 'abc_DEF-123',
    });
  });

  it.each([
    ['undefined', undefined],
    ['a number', 42],
    ['no dot', SESSION_ID],
    ['an empty secret', `${SESSION_ID}.`],
    ['a session id that is not a uuid', 'abc.secret'],
    ['too many parts', `${SESSION_ID}.a.b`],
  ])('rejects %s', (_label, token) => {
    expect(service().tokens.parseRefreshToken(token)).toBeNull();
  });

  it('matches a secret only against its own hash', () => {
    const { tokens } = service();
    const { secret, hash } = tokens.newRefreshSecret();

    expect(tokens.secretMatches(secret, hash)).toBe(true);
    expect(tokens.secretMatches('other', hash)).toBe(false);
    expect(tokens.secretMatches(secret, 'not-hex')).toBe(false);
  });
});
