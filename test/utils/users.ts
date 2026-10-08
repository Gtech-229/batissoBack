import { generateKeyPairSync, sign } from 'node:crypto';
import { hashPassword } from '../../src/admin-auth/secrets.js';
import { pepperPin } from '../../src/mobile-auth/pin-hasher.js';
import type { PrismaService } from '../../src/prisma/prisma.service.js';

export const TEST_PHONE = '+22376000000';
export const TEST_PIN = '482915';

/** The PIN hash the API stores, with the test pepper from .env.test. */
export function testPinHash(pin: string): Promise<string> {
  return hashPassword(pepperPin(pin, process.env.PIN_PEPPER!));
}

/** Inserts a mobile user; pass `pin` to make them already activated. */
export async function createUser(
  prisma: PrismaService,
  overrides: { phone?: string; pin?: string; firstName?: string } = {},
) {
  return prisma.user.create({
    data: {
      phone: overrides.phone ?? TEST_PHONE,
      firstName: overrides.firstName ?? 'Awa',
      lastName: 'Diallo',
      pinHash: overrides.pin ? await testPinHash(overrides.pin) : null,
    },
  });
}

/**
 * What the app does in the phone's secure hardware: a P-256 key pair. The public
 * key goes to the API (SPKI DER, base64); the private key only signs.
 */
export function newDeviceKey() {
  const { publicKey, privateKey } = generateKeyPairSync('ec', {
    namedCurve: 'prime256v1',
  });
  return {
    publicKey: publicKey
      .export({ format: 'der', type: 'spki' })
      .toString('base64'),
    sign: (message: string) =>
      sign('sha256', Buffer.from(message, 'utf8'), privateKey).toString(
        'base64',
      ),
  };
}
