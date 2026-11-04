import type { ConfigService } from '@nestjs/config';
import { Logger } from '@nestjs/common';
import type { EnvironmentVariables } from '../config/env.validation.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import { verifyPassword } from './secrets.js';
import { SuperAdminBootstrapService } from './super-admin-bootstrap.service.js';

interface Setup {
  existingSuperAdmin?: boolean;
  emailOwner?: boolean;
  email?: string;
  password?: string;
}

function setup(options: Setup = {}) {
  const { existingSuperAdmin = false, emailOwner = false } = options;
  // `'key' in options` so an explicit `undefined` means "missing" instead of
  // falling back to a default value.
  const email = 'email' in options ? options.email : 'admin@batisso.com';
  const password = 'password' in options ? options.password : 'Batisso#2026';
  const prisma = {
    admin: {
      findFirst: vi
        .fn()
        .mockResolvedValue(existingSuperAdmin ? { id: 'super-1' } : null),
      findUnique: vi
        .fn()
        .mockResolvedValue(emailOwner ? { id: 'admin-1' } : null),
      create: vi.fn().mockResolvedValue({ id: 'new-super' }),
    },
  };
  const env: Record<string, string | undefined> = {
    SUPER_ADMIN_EMAIL: email,
    SUPER_ADMIN_PASSWORD: password,
  };
  const config = { get: vi.fn((key: string) => env[key]) };
  const service = new SuperAdminBootstrapService(
    prisma as unknown as PrismaService,
    config as unknown as ConfigService<EnvironmentVariables, true>,
  );
  return { prisma, service };
}

describe('SuperAdminBootstrapService', () => {
  beforeEach(() => {
    vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
  });
  afterEach(() => vi.restoreAllMocks());

  it('does nothing when a super admin already exists', async () => {
    const { service, prisma } = setup({ existingSuperAdmin: true });

    await service.onApplicationBootstrap();

    expect(prisma.admin.create).not.toHaveBeenCalled();
  });

  it('does not require the env values when a super admin exists', async () => {
    const { service } = setup({
      existingSuperAdmin: true,
      email: undefined,
      password: undefined,
    });

    await expect(service.onApplicationBootstrap()).resolves.toBeUndefined();
  });

  it('creates the super admin with a hashed password', async () => {
    const { service, prisma } = setup();

    await service.onApplicationBootstrap();

    expect(prisma.admin.create).toHaveBeenCalledTimes(1);
    const { data } = prisma.admin.create.mock.calls[0][0] as {
      data: Record<string, unknown>;
    };
    expect(data).toMatchObject({
      email: 'admin@batisso.com',
      firstName: 'Super',
      lastName: 'Administrateur',
      role: 'SUPER_ADMIN',
    });
    expect(data.passwordHash).not.toBe('Batisso#2026');
    await expect(
      verifyPassword('Batisso#2026', data.passwordHash as string),
    ).resolves.toBe(true);
  });

  it.each([
    ['SUPER_ADMIN_EMAIL', { email: undefined }],
    ['SUPER_ADMIN_PASSWORD', { password: undefined }],
  ])(
    'fails startup when %s is missing and no super admin exists',
    async (_name, missing) => {
      const { service, prisma } = setup(missing);

      await expect(service.onApplicationBootstrap()).rejects.toThrow(
        /SUPER_ADMIN_EMAIL and SUPER_ADMIN_PASSWORD/,
      );
      expect(prisma.admin.create).not.toHaveBeenCalled();
    },
  );

  it('fails startup when the email already belongs to an ADMIN', async () => {
    const { service, prisma } = setup({ emailOwner: true });

    await expect(service.onApplicationBootstrap()).rejects.toThrow(
      /already belongs to an ADMIN/,
    );
    expect(prisma.admin.create).not.toHaveBeenCalled();
  });
});
