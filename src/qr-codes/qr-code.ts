import { randomBytes } from 'node:crypto';

/**
 * The codes behind the QR codes (feature 23): 24 random bytes as 32 base64url
 * characters. Opaque: nothing inside, they only point to a row (192 random
 * bits, so they cannot be guessed and never collide in practice).
 */
const QR_CODE_BYTES = 24;

/** What a scanned code must look like. */
export const QR_CODE_PATTERN = /^[A-Za-z0-9_-]{32}$/;

export function newQrCode(): string {
  return randomBytes(QR_CODE_BYTES).toString('base64url');
}
