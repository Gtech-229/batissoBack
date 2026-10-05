import { UnauthorizedException } from '@nestjs/common';
import type { PrismaService } from '../prisma/prisma.service.js';
import type { SystemSettingsService } from '../system-settings/system-settings.service.js';
import { AdminAuthService } from './admin-auth.service.js';
import { hashPassword } from './secrets.js';
import type { TokensService } from './tokens.service.js';

const NIL_UUID = '00000000-0000-0000-0000-000000000000';

async function setup(admin: Record<string, unknown> | null) {
  const tx = {
    // A real admin row is found and locked; the nil id matches nothing.
    $queryRaw: vi
      .fn()
      .mockResolvedValue(
        admin ? [{ lockedUntil: null, failedLoginAttempts: 0 }] : [],
      ),
    admin: {
      update: vi.fn().mockResolvedValue({}),
      updateMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
  };
  const prisma = {
    admin: { findUnique: vi.fn().mockResolvedValue(admin) },
    $transaction: vi.fn((work: (client: typeof tx) => unknown) => work(tx)),
  };
  const settings = {
    get: vi
      .fn()
      .mockResolvedValue({ maxLoginAttempts: 5, maxAdminSessions: 3 }),
  };
  const tokens = {
    newRefreshSecret: vi.fn().mockReturnValue({ secret: 's', hash: 'h' }),
  };
  const service = new AdminAuthService(
    prisma as unknown as PrismaService,
    tokens as unknown as TokensService,
    settings as unknown as SystemSettingsService,
  );
  return { service, prisma, tx, settings };
}

describe('AdminAuthService.login: equal work for unknown emails (F-02)', () => {
  let knownAdmin: Record<string, unknown>;

  beforeAll(async () => {
    knownAdmin = {
      id: '0192f0a4-7b1c-7c3e-9d2a-5e6f7a8b9c0d',
      email: 'awa@batisso.test',
      passwordHash: await hashPassword('Batisso#2026'),
      isActive: true,
      lockedUntil: null,
    };
  });

  it('a wrong password on a known email reads settings and runs the locked transaction', async () => {
    const { service, prisma, tx, settings } = await setup(knownAdmin);

    await expect(
      service.login('awa@batisso.test', 'Wrong#Pass1', undefined),
    ).rejects.toBeInstanceOf(UnauthorizedException);

    expect(settings.get).toHaveBeenCalledTimes(1);
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(tx.$queryRaw).toHaveBeenCalledTimes(1);
    expect(tx.admin.update).toHaveBeenCalledTimes(1);
  });

  it('an unknown email does the same reads and transaction, on no row', async () => {
    const { service, prisma, tx, settings } = await setup(null);

    const error = await service
      .login('nobody@batisso.test', 'Wrong#Pass1', undefined)
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(UnauthorizedException);
    expect((error as UnauthorizedException).getResponse()).toMatchObject({
      error: 'INVALID_CREDENTIALS',
    });
    expect(settings.get).toHaveBeenCalledTimes(1);
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(tx.$queryRaw).toHaveBeenCalledTimes(1);
    // The counter write targets the nil id, so it changes nothing.
    expect(tx.admin.updateMany).toHaveBeenCalledWith({
      where: { id: NIL_UUID },
      data: { failedLoginAttempts: { increment: 1 } },
    });
    expect(tx.admin.update).not.toHaveBeenCalled();
  });
});
