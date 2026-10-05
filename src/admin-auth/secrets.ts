import {
  createHash,
  randomBytes,
  scrypt,
  timingSafeEqual,
  type BinaryLike,
} from 'node:crypto';

const SALT_BYTES = 16;
const KEY_BYTES = 64;
const PREFIX = 'scrypt';

function deriveKey(password: string, salt: BinaryLike): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, KEY_BYTES, (error, key) =>
      error ? reject(error) : resolve(key),
    );
  });
}

/** Slow, salted hash for passwords: `scrypt$<saltB64>$<hashB64>`. */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_BYTES);
  const key = await deriveKey(password, salt);
  return `${PREFIX}$${salt.toString('base64')}$${key.toString('base64')}`;
}

/** Recomputes the hash with the stored salt and compares in constant time. */
export async function verifyPassword(
  password: string,
  stored: string,
): Promise<boolean> {
  const [prefix, saltB64, keyB64] = stored.split('$');
  if (prefix !== PREFIX || !saltB64 || !keyB64) {
    return false;
  }
  const expected = Buffer.from(keyB64, 'base64');
  if (expected.length !== KEY_BYTES) {
    return false;
  }
  const actual = await deriveKey(password, Buffer.from(saltB64, 'base64'));
  return timingSafeEqual(actual, expected);
}

/**
 * Fast hash for refresh tokens. They are 32 random bytes, so they cannot be
 * guessed; a slow hash would only cost time on every refresh.
 */
export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
