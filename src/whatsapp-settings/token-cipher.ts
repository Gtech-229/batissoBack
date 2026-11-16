import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const ALGORITHM = 'aes-256-gcm';
const VERSION = 'v1';
const IV_BYTES = 12;
const TAG_BYTES = 16;
/** Binds a ciphertext to its use: one made for another purpose fails. */
const ADDITIONAL_DATA = Buffer.from('batisso:whatsapp-token', 'utf8');

/**
 * Encrypts the WhatsApp token at rest (25b), AES-256-GCM, with the key from
 * SETTINGS_ENCRYPTION_KEY (64 hex characters, validated at startup). Stored
 * as `v1:<iv>:<tag>:<ciphertext>`, each part base64, a new random IV each
 * time. Never logs a value.
 */
export class TokenCipher {
  private readonly key: Buffer | null;

  constructor(keyHex: string | undefined) {
    this.key = keyHex ? Buffer.from(keyHex, 'hex') : null;
  }

  /** False without SETTINGS_ENCRYPTION_KEY: no token can be saved. */
  get available(): boolean {
    return this.key !== null;
  }

  /** Throws without a key: callers check `available` first. */
  encrypt(token: string): string {
    if (!this.key) {
      throw new Error('No encryption key');
    }
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv(ALGORITHM, this.key, iv, {
      authTagLength: TAG_BYTES,
    });
    cipher.setAAD(ADDITIONAL_DATA);
    const ciphertext = Buffer.concat([
      cipher.update(token, 'utf8'),
      cipher.final(),
    ]);
    return [
      VERSION,
      iv.toString('base64'),
      cipher.getAuthTag().toString('base64'),
      ciphertext.toString('base64'),
    ].join(':');
  }

  /**
   * The token, or null when it cannot be read: no key, another key, an
   * altered value or an unknown format. Never throws: an unreadable token is
   * treated as not configured.
   */
  decrypt(stored: string): string | null {
    if (!this.key) {
      return null;
    }
    const parts = stored.split(':');
    if (parts.length !== 4 || parts[0] !== VERSION) {
      return null;
    }
    const [, ivText, tagText, ciphertextText] = parts;
    const iv = Buffer.from(ivText, 'base64');
    const tag = Buffer.from(tagText, 'base64');
    if (iv.length !== IV_BYTES || tag.length !== TAG_BYTES) {
      return null;
    }
    try {
      const decipher = createDecipheriv(ALGORITHM, this.key, iv, {
        authTagLength: TAG_BYTES,
      });
      decipher.setAAD(ADDITIONAL_DATA);
      decipher.setAuthTag(tag);
      return Buffer.concat([
        decipher.update(Buffer.from(ciphertextText, 'base64')),
        decipher.final(),
      ]).toString('utf8');
    } catch {
      // Wrong key or altered value: the tag does not match.
      return null;
    }
  }
}
