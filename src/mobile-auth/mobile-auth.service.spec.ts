import { ForbiddenException } from '@nestjs/common';
import type { TokensService } from '../admin-auth/tokens.service.js';
import type { NotificationsService } from '../notifications/notifications.service.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import type { SmsSender } from '../sms/sms-sender.js';
import type { SystemSettingsService } from '../system-settings/system-settings.service.js';
import { maskPhone, MobileAuthService } from './mobile-auth.service.js';
import type { PinCheck } from './pin-check.service.js';
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
    {} as PinCheck,
    {} as NotificationsService,
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

describe('MobileAuthService.recover: answers changed during the check', () => {
  const answers = [{ questionId: 'q1', answer: 'Fatou' }];

  /** Hash `checked` was verified; `current` is what the lock finds. */
  function recovering(pinOk: boolean) {
    const update = vi.fn();
    const tx = {
      $queryRaw: vi
        .fn()
        .mockResolvedValueOnce([
          { id: 'v1', tokenExpiresAt: new Date(Date.now() + 60_000) },
        ])
        .mockResolvedValueOnce([
          { failedRecoveryAttempts: 1, recoveryLockedUntil: null },
        ]),
      user: { update },
      userSecurityAnswer: {
        findMany: vi.fn().mockResolvedValue([{ answerHash: 'current' }]),
      },
    };
    const prisma = {
      phoneVerification: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'v1',
          phone: '+22376000000',
          deviceId: 'device',
          consumedAt: null,
          tokenExpiresAt: new Date(Date.now() + 60_000),
        }),
      },
      user: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'user-1',
          phone: '+22376000000',
          recoveryLockedUntil: null,
        }),
      },
      userSecurityAnswer: {
        findMany: vi
          .fn()
          .mockResolvedValue([{ questionId: 'q1', answerHash: 'checked' }]),
      },
      $transaction: vi.fn((run: (client: typeof tx) => unknown) => run(tx)),
    };
    const service = new MobileAuthService(
      prisma as unknown as PrismaService,
      {} as SmsSender,
      {
        newRefreshSecret: () => ({ secret: 's', hash: 'h' }),
      } as unknown as TokensService,
      {} as SystemSettingsService,
      {
        verify: vi.fn().mockResolvedValue(pinOk),
        hash: vi.fn().mockResolvedValue('new-pin-hash'),
      } as unknown as PinHasher,
      {} as PinCheck,
      {} as NotificationsService,
    );
    return { service, update };
  }

  it.each([
    ['right', true],
    ['wrong', false],
  ])(
    'refuses %s answers to old hashes without counting a try',
    async (_label, answersOk) => {
      const { service, update } = recovering(answersOk);

      await expect(
        service.recover('token', answers, '730164', 'key', undefined),
      ).rejects.toMatchObject({
        response: expect.objectContaining({
          error: 'INVALID_RECOVERY_ANSWERS',
        }) as unknown,
      });

      expect(update).not.toHaveBeenCalled();
    },
  );
});

describe('maskPhone', () => {
  it('keeps the prefix and the last two digits only', () => {
    expect(maskPhone('+22376000012')).toBe('+223******12');
  });
});
