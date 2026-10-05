import { hashPassword, hashToken, verifyPassword } from './secrets.js';

describe('password hashing', () => {
  it('verifies the original password against its hash', async () => {
    const hash = await hashPassword('Batisso#2026');

    expect(hash).toMatch(/^scrypt\$[A-Za-z0-9+/=]+\$[A-Za-z0-9+/=]+$/);
    expect(hash).not.toContain('Batisso#2026');
    await expect(verifyPassword('Batisso#2026', hash)).resolves.toBe(true);
  });

  it('rejects a wrong password', async () => {
    const hash = await hashPassword('Batisso#2026');

    await expect(verifyPassword('batisso#2026', hash)).resolves.toBe(false);
  });

  it('uses a new salt every time', async () => {
    const [first, second] = await Promise.all([
      hashPassword('Batisso#2026'),
      hashPassword('Batisso#2026'),
    ]);

    expect(first).not.toBe(second);
  });

  it.each([
    ['an empty string', ''],
    ['another algorithm', 'bcrypt$abc$def'],
    ['a missing part', 'scrypt$abc'],
    ['a truncated key', 'scrypt$c2FsdA==$c2hvcnQ='],
  ])('returns false for %s instead of throwing', async (_label, stored) => {
    await expect(verifyPassword('Batisso#2026', stored)).resolves.toBe(false);
  });
});

describe('hashToken', () => {
  it('is deterministic, hex, and does not contain the token', () => {
    const token = 'session-id.secret-value';

    expect(hashToken(token)).toBe(hashToken(token));
    expect(hashToken(token)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashToken(token)).not.toContain('secret');
  });

  it('differs for different tokens', () => {
    expect(hashToken('a.b')).not.toBe(hashToken('a.c'));
  });
});
