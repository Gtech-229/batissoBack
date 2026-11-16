import { TokenCipher } from './token-cipher.js';

const KEY = '0f'.repeat(32);
const OTHER_KEY = 'f0'.repeat(32);
const TOKEN = 'd75b3a66374942c5b3c019c698abc2067e151558acbd412345';

describe('TokenCipher', () => {
  it('round-trips a token', () => {
    const cipher = new TokenCipher(KEY);

    const stored = cipher.encrypt(TOKEN);

    expect(cipher.decrypt(stored)).toBe(TOKEN);
  });

  it('stores v1 and three base64 parts, never the token itself', () => {
    const stored = new TokenCipher(KEY).encrypt(TOKEN);

    const parts = stored.split(':');
    expect(parts).toHaveLength(4);
    expect(parts[0]).toBe('v1');
    expect(Buffer.from(parts[1], 'base64')).toHaveLength(12);
    expect(Buffer.from(parts[2], 'base64')).toHaveLength(16);
    expect(stored).not.toContain(TOKEN);
    expect(stored).not.toContain(TOKEN.slice(0, 10));
  });

  it('uses a new IV each time', () => {
    const cipher = new TokenCipher(KEY);

    const first = cipher.encrypt(TOKEN);
    const second = cipher.encrypt(TOKEN);

    expect(first).not.toBe(second);
    expect(first.split(':')[1]).not.toBe(second.split(':')[1]);
  });

  it('cannot read a token encrypted with another key', () => {
    const stored = new TokenCipher(OTHER_KEY).encrypt(TOKEN);

    expect(new TokenCipher(KEY).decrypt(stored)).toBeNull();
  });

  /** Flips one byte of the given part, keeping valid base64. */
  function alter(stored: string, index: 1 | 2 | 3): string {
    const parts = stored.split(':');
    const bytes = Buffer.from(parts[index], 'base64');
    bytes[0] ^= 0x01;
    parts[index] = bytes.toString('base64');
    return parts.join(':');
  }

  it.each([
    ['the IV', 1],
    ['the tag', 2],
    ['the ciphertext', 3],
  ] as const)('refuses a value whose %s was altered', (_label, index) => {
    const cipher = new TokenCipher(KEY);

    expect(cipher.decrypt(alter(cipher.encrypt(TOKEN), index))).toBeNull();
  });

  it.each([
    ['an empty value', ''],
    ['plain text', TOKEN],
    ['another version', 'v2:AAAA:AAAA:AAAA'],
    ['missing parts', 'v1:AAAA:AAAA'],
    [
      'a short IV',
      `v1:${Buffer.alloc(8).toString('base64')}:${Buffer.alloc(16).toString('base64')}:AAAA`,
    ],
  ])('returns null for %s', (_label, stored) => {
    expect(new TokenCipher(KEY).decrypt(stored)).toBeNull();
  });

  describe('without a key', () => {
    const cipher = new TokenCipher(undefined);

    it('is not available and reads nothing', () => {
      expect(cipher.available).toBe(false);
      expect(cipher.decrypt(new TokenCipher(KEY).encrypt(TOKEN))).toBeNull();
    });

    it('refuses to encrypt, without the token in the error', () => {
      expect(() => cipher.encrypt(TOKEN)).toThrow('No encryption key');
    });
  });
});
