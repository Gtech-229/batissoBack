import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import type { PrismaService } from '../prisma/prisma.service.js';
import type { SystemSettingsService } from '../system-settings/system-settings.service.js';
import { AdminAuthService, DUMMY_PASSWORD } from './admin-auth.service.js';
import { hashPassword } from './secrets.js';
import type { TokensService } from './tokens.service.js';

const NIL_UUID = '00000000-0000-0000-0000-000000000000';

async function setup(
  admin: Record<string, unknown> | null,
  // The hash found under the lock: the admin's own unless a reset replaced it.
  lockedHash: string | null = (admin?.passwordHash as string | null) ?? null,
) {
  const tx = {
    // A real admin row is found and locked; the nil id matches nothing.
    $queryRaw: vi.fn().mockResolvedValue(
      admin
        ? [
            {
              lockedUntil: null,
              failedLoginAttempts: 0,
              passwordHash: lockedHash,
            },
          ]
        : [],
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

describe('AdminAuthService.login: one verdict per hash', () => {
  const invalid = { error: 'INVALID_CREDENTIALS' };

  it('never accepts the dummy password for an admin without one (F-36)', async () => {
    const { service, tx } = await setup({
      id: '0192f0a4-7b1c-7c3e-9d2a-5e6f7a8b9c0d',
      email: 'new@batisso.test',
      passwordHash: null,
      isActive: true,
      lockedUntil: null,
    });

    const error = await service
      .login('new@batisso.test', DUMMY_PASSWORD, undefined)
      .catch((e: unknown) => e);

    expect((error as UnauthorizedException).getResponse()).toMatchObject(
      invalid,
    );
    // Counted like any wrong password.
    expect(tx.admin.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { failedLoginAttempts: 1 } }),
    );
  });

  it('refuses, uncounted, a right password whose hash a reset replaced before the lock (F-37)', async () => {
    const { service, tx } = await setup(
      {
        id: '0192f0a4-7b1c-7c3e-9d2a-5e6f7a8b9c0d',
        email: 'awa@batisso.test',
        passwordHash: await hashPassword('Batisso#2026'),
        isActive: true,
        lockedUntil: null,
      },
      await hashPassword('Nouveau#2026'),
    );

    const error = await service
      .login('awa@batisso.test', 'Batisso#2026', undefined)
      .catch((e: unknown) => e);

    expect((error as UnauthorizedException).getResponse()).toMatchObject(
      invalid,
    );
    expect(tx.admin.update).not.toHaveBeenCalled();
  });
});

describe('AdminAuthService.confirmPassword (25b)', () => {
  const ADMIN_ID = '0192f0a4-7b1c-7c3e-9d2a-5e6f7a8b9c0d';
  let admin: Record<string, unknown>;

  beforeAll(async () => {
    admin = {
      id: ADMIN_ID,
      passwordHash: await hashPassword('Batisso#2026'),
      lockedUntil: null,
    };
  });

  it('accepts the right password and resets the counter', async () => {
    const { service, tx } = await setup(admin);

    await expect(
      service.confirmPassword(ADMIN_ID, 'Batisso#2026'),
    ).resolves.toBeUndefined();

    expect(tx.admin.update).toHaveBeenCalledWith({
      where: { id: ADMIN_ID },
      data: { failedLoginAttempts: 0, lockedUntil: null },
    });
  });

  it('counts a wrong password in the login lockout, then refuses it', async () => {
    const { service, tx } = await setup(admin);

    await expect(
      service.confirmPassword(ADMIN_ID, 'Wrong#Pass1'),
    ).rejects.toBeInstanceOf(UnauthorizedException);

    expect(tx.admin.update).toHaveBeenCalledWith({
      where: { id: ADMIN_ID },
      data: { failedLoginAttempts: 1 },
    });
  });

  it('locks the account when the wrong password reaches maxLoginAttempts', async () => {
    const { service, tx } = await setup(admin);
    tx.$queryRaw.mockResolvedValue([
      {
        lockedUntil: null,
        failedLoginAttempts: 4,
        passwordHash: admin.passwordHash,
      },
    ]);

    await expect(
      service.confirmPassword(ADMIN_ID, 'Wrong#Pass1'),
    ).rejects.toBeInstanceOf(UnauthorizedException);

    const [{ data }] = tx.admin.update.mock.calls[0] as [
      { data: { failedLoginAttempts: number; lockedUntil: Date } },
    ];
    expect(data.failedLoginAttempts).toBe(0);
    expect(data.lockedUntil.getTime()).toBeGreaterThan(Date.now());
  });

  it('refuses a locked account without counting, even with the right password', async () => {
    const lockedUntil = new Date(Date.now() + 10 * 60 * 1000);
    const { service, prisma, tx } = await setup({ ...admin, lockedUntil });

    await expect(
      service.confirmPassword(ADMIN_ID, 'Batisso#2026'),
    ).rejects.toBeInstanceOf(ForbiddenException);

    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(tx.admin.update).not.toHaveBeenCalled();
  });

  it('refuses, under the lock, an account locked since the first read', async () => {
    const { service, tx } = await setup(admin);
    tx.$queryRaw.mockResolvedValue([
      {
        lockedUntil: new Date(Date.now() + 60_000),
        failedLoginAttempts: 0,
        passwordHash: admin.passwordHash,
      },
    ]);

    await expect(
      service.confirmPassword(ADMIN_ID, 'Batisso#2026'),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(tx.admin.update).not.toHaveBeenCalled();
  });

  it('refuses an admin without a password', async () => {
    const { service } = await setup({ ...admin, passwordHash: null });

    await expect(
      service.confirmPassword(ADMIN_ID, 'Batisso#2026'),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });
});
