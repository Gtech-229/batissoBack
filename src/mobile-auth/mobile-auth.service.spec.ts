import { ForbiddenException } from '@nestjs/common';
import type { TokensService } from '../admin-auth/tokens.service.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import type { SmsSender } from '../sms/sms-sender.js';
import type { SystemSettingsService } from '../system-settings/system-settings.service.js';
import { maskPhone, MobileAuthService } from './mobile-auth.service.js';
import type { PinHasher } from './pin-hasher.js';

/** The service with a mocked Prisma: only what `login` reads before the PIN. */
function setup(options: { challengeCount: number; user: object | null }) {
  const prisma = {
    country: { findFirst: vi.fn().mockResolvedValue({ code: 'ML' }) },
    deviceChallenge: {
      updateMany: vi.fn().mockResolvedValue({ count: options.challengeCount }),
    },
    user: { findUnique: vi.fn().mockResolvedValue(options.user) },
    userDevice: { findUnique: vi.fn().mockResolvedValue(null) },
  };
  const service = new MobileAuthService(
    prisma as unknown as PrismaService,
    {} as SmsSender,
    {} as TokensService,
    {} as SystemSettingsService,
    {} as PinHasher,
  );
  return { prisma, service };
}

const login = (service: MobileAuthService) =>
  service.login('76 00 00 00', '482915', 'device-0001-abcd', 'c', 'AAAA');

describe('MobileAuthService.login: same work on every refusal (F-15)', () => {
  it.each([
    ['an unknown phone with a valid challenge', 1, null],
    ['a known phone with a used challenge', 0, { id: 'user-1', pinHash: 'h' }],
    ['an unknown phone with a used challenge', 0, null],
  ])(
    'still looks up the user and the device for %s',
    async (_label, challengeCount, user) => {
      const { prisma, service } = setup({ challengeCount, user });

      await expect(login(service)).rejects.toBeInstanceOf(ForbiddenException);

      expect(prisma.user.findUnique).toHaveBeenCalledTimes(1);
      expect(prisma.userDevice.findUnique).toHaveBeenCalledTimes(1);
    },
  );
});

describe('maskPhone', () => {
  it('keeps the prefix and the last two digits only', () => {
    expect(maskPhone('+22376000012')).toBe('+223******12');
  });
});
