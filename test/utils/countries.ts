import type { PrismaService } from '../../src/prisma/prisma.service.js';

/** Inserts Mali (XOF, +223), active by default. */
export function createMali(prisma: PrismaService, active = true) {
  return prisma.country.create({
    data: {
      code: 'ML',
      name: 'Mali',
      phonePrefix: '+223',
      currencyCode: 'XOF',
      currencySymbol: 'F CFA',
      decimals: 0,
      active,
    },
  });
}

/** A valid registration body for a store in Mali. */
export function storeBody(overrides: Record<string, unknown> = {}) {
  return {
    countryCode: 'ML',
    name: 'Quincaillerie du Carrefour',
    address: 'Rue 12, Hippodrome',
    city: 'Bamako',
    phone: '20 22 00 00',
    tradeRegister: 'MA.BKO.2026.B.1234',
    settings: {
      maxBalance: '2000000',
      validationThreshold: '200000',
      minDeposit: '500',
    },
    manager: { firstName: 'Awa', lastName: 'Diallo', phone: '76 00 00 00' },
    ...overrides,
  };
}

/** Inserts a store with settings directly (fast setup for list and update tests). */
export function createStoreRecord(
  prisma: PrismaService,
  overrides: {
    name?: string;
    city?: string;
    status?: 'PENDING' | 'VERIFIED' | 'SUSPENDED' | 'CLOSED';
    countryCode?: string;
    createdAt?: Date;
  } = {},
) {
  return prisma.hardwareStore.create({
    data: {
      countryCode: overrides.countryCode ?? 'ML',
      name: overrides.name ?? 'Quincaillerie du Carrefour',
      address: 'Rue 12',
      city: overrides.city ?? 'Bamako',
      phone: '+22320220000',
      tradeRegister: 'MA.BKO.2026.B.1234',
      status: overrides.status ?? 'PENDING',
      createdAt: overrides.createdAt,
      settings: {
        create: {
          maxBalance: 2000000n,
          validationThreshold: 200000n,
          minDeposit: 500n,
        },
      },
    },
  });
}
