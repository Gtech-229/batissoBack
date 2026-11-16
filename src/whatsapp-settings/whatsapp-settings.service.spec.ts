import type { AdminAuthService } from '../admin-auth/admin-auth.service.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import { TokenCipher } from './token-cipher.js';
import { WhatsappSettingsService } from './whatsapp-settings.service.js';

const KEY = '0f'.repeat(32);
const TOKEN = 'd75b3a66374942c5b3c019c698abc2067e151558acbd412345';
const cipher = new TokenCipher(KEY);

function serviceWith(row: Record<string, unknown> | null) {
  const prisma = {
    whatsappSettings: { findUnique: vi.fn().mockResolvedValue(row) },
  };
  return new WhatsappSettingsService(
    prisma as unknown as PrismaService,
    cipher,
    {} as AdminAuthService,
    vi.fn(),
  );
}

describe('WhatsappSettingsService.deliveryCredentials (25c)', () => {
  const ready = {
    enabled: true,
    instanceId: '7103123456',
    tokenCiphertext: cipher.encrypt(TOKEN),
  };

  it('returns the instance and the decrypted token when WhatsApp is on', async () => {
    await expect(serviceWith(ready).deliveryCredentials()).resolves.toEqual({
      instanceId: '7103123456',
      token: TOKEN,
    });
  });

  it.each([
    ['nothing was ever saved', null],
    ['WhatsApp is off', { ...ready, enabled: false }],
    ['no instance', { ...ready, instanceId: null }],
    ['no token', { ...ready, tokenCiphertext: null }],
    [
      'a token saved under another key',
      {
        ...ready,
        tokenCiphertext: new TokenCipher('f0'.repeat(32)).encrypt(TOKEN),
      },
    ],
  ])('returns null when %s', async (_label, row) => {
    await expect(serviceWith(row).deliveryCredentials()).resolves.toBeNull();
  });
});
