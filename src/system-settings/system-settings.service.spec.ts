import type { PrismaService } from '../prisma/prisma.service.js';
import {
  DEFAULT_SYSTEM_SETTINGS,
  SystemSettingsService,
} from './system-settings.service.js';

function setup(row: Record<string, unknown> | null = null) {
  const prisma = {
    systemSettings: {
      findUnique: vi.fn().mockResolvedValue(row),
      upsert: vi
        .fn()
        .mockImplementation(({ create }) => Promise.resolve(create)),
    },
  };
  const service = new SystemSettingsService(prisma as unknown as PrismaService);
  return { prisma, service };
}

describe('SystemSettingsService', () => {
  it('returns the defaults when no settings were saved yet', async () => {
    const { service } = setup(null);

    await expect(service.get()).resolves.toEqual({
      maxLoginAttempts: 5,
      maxAdminSessions: 3,
      maxPinAttempts: 5,
      deliveryAlertDays: 7,
      cancellationEscalationHours: 48,
    });
  });

  it('returns a copy of the defaults, not the shared object', async () => {
    const { service } = setup(null);

    const settings = await service.get();
    settings.maxLoginAttempts = 99;

    expect(DEFAULT_SYSTEM_SETTINGS.maxLoginAttempts).toBe(5);
  });

  it('returns the saved values', async () => {
    const { service } = setup({
      id: 1,
      maxLoginAttempts: 8,
      maxAdminSessions: 2,
      maxPinAttempts: 0,
      deliveryAlertDays: 7,
      cancellationEscalationHours: 48,
      updatedAt: new Date(),
      updatedById: 'admin-1',
    });

    await expect(service.get()).resolves.toEqual({
      maxLoginAttempts: 8,
      maxAdminSessions: 2,
      maxPinAttempts: 0,
      deliveryAlertDays: 7,
      cancellationEscalationHours: 48,
    });
  });

  it('first save starts from the defaults and records who saved', async () => {
    const { service, prisma } = setup(null);

    const result = await service.update({ maxLoginAttempts: 10 }, 'admin-1');

    expect(prisma.systemSettings.upsert).toHaveBeenCalledWith({
      where: { id: 1 },
      create: {
        id: 1,
        maxLoginAttempts: 10,
        maxAdminSessions: 3,
        maxPinAttempts: 5,
        deliveryAlertDays: 7,
        cancellationEscalationHours: 48,
        updatedById: 'admin-1',
      },
      update: { maxLoginAttempts: 10, updatedById: 'admin-1' },
    });
    expect(result).toEqual({
      maxLoginAttempts: 10,
      maxAdminSessions: 3,
      maxPinAttempts: 5,
      deliveryAlertDays: 7,
      cancellationEscalationHours: 48,
    });
  });

  it('ignores fields set to undefined, as an omitted DTO field is', async () => {
    const { service, prisma } = setup(null);

    const result = await service.update(
      { maxLoginAttempts: undefined, maxAdminSessions: 1 },
      'admin-1',
    );

    const call = prisma.systemSettings.upsert.mock.calls[0][0] as {
      create: Record<string, unknown>;
      update: Record<string, unknown>;
    };
    expect(call.create.maxLoginAttempts).toBe(5);
    expect(call.update).not.toHaveProperty('maxLoginAttempts');
    expect(result).toEqual({
      maxLoginAttempts: 5,
      maxAdminSessions: 1,
      maxPinAttempts: 5,
      deliveryAlertDays: 7,
      cancellationEscalationHours: 48,
    });
  });
});
