import { createPublicKey, verify, type KeyObject } from 'node:crypto';
import { ValidateBy } from 'class-validator';

export const DEVICE_KEY_MESSAGE =
  'La clé publique doit être une clé EC P-256 au format SPKI DER, encodée en base64';

const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;
// A P-256 SPKI key is 91 bytes (124 base64 characters): a generous upper bound
// keeps oversized input away from the key parser.
const MAX_KEY_LENGTH = 500;

/**
 * The public key a device registered, if it is a valid P-256 key (SPKI DER,
 * base64), the only curve both Android Keystore and the iOS Secure Enclave
 * support. Null for anything else.
 */
export function parseDevicePublicKey(value: unknown): KeyObject | null {
  if (
    typeof value !== 'string' ||
    value.length > MAX_KEY_LENGTH ||
    !BASE64.test(value)
  ) {
    return null;
  }
  try {
    const key = createPublicKey({
      key: Buffer.from(value, 'base64'),
      format: 'der',
      type: 'spki',
    });
    const p256 =
      key.asymmetricKeyType === 'ec' &&
      key.asymmetricKeyDetails?.namedCurve === 'prime256v1';
    return p256 ? key : null;
  } catch {
    return null;
  }
}

/**
 * True when `signature` (ECDSA P-256 with SHA-256, DER, base64) was made over
 * `message` by the private key matching `publicKey`. Malformed input is simply
 * not a valid signature.
 */
export function isValidDeviceSignature(
  publicKey: string,
  message: string,
  signature: string,
): boolean {
  const key = parseDevicePublicKey(publicKey);
  if (!key || !BASE64.test(signature)) {
    return false;
  }
  try {
    return verify(
      'sha256',
      Buffer.from(message, 'utf8'),
      key,
      Buffer.from(signature, 'base64'),
    );
  } catch {
    return false;
  }
}

/** DTO check for a device public key, with a French message. */
export function IsDevicePublicKey(): PropertyDecorator {
  return ValidateBy(
    {
      name: 'isDevicePublicKey',
      validator: { validate: (value) => parseDevicePublicKey(value) !== null },
    },
    { message: DEVICE_KEY_MESSAGE },
  );
}
