import type { INestApplication } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { App } from 'supertest/types.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { createTestApp } from './utils/app.js';
import { createMali, createStoreRecord } from './utils/countries.js';
import { resetDatabase } from './utils/reset-database.js';
import { createUser } from './utils/users.js';

// The delivery columns the database holds by itself (migration
// `order_delivery`), whatever the client of the database.
describe('Order delivery schema (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let storeId: string;
  let accountId: string;
  let goalId: string;
  let sellerId: string;

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
  });

  beforeEach(async () => {
    await resetDatabase(prisma);
    await createMali(prisma);
    storeId = (await createStoreRecord(prisma, { status: 'VERIFIED' })).id;
    const customer = await createUser(prisma, { phone: '+22376445566' });
    sellerId = (await createUser(prisma, { phone: '+22376000001' })).id;
    const account = await prisma.account.create({
      data: {
        number: 'C-000001',
        customerId: customer.id,
        storeId,
        currencyCode: 'XOF',
        balance: 100000n,
        termsAcceptedAt: new Date(),
        openedById: sellerId,
        goals: {
          create: { label: 'Non affecté', isSystem: true, balance: 100000n },
        },
      },
      include: { goals: true },
    });
    accountId = account.id;
    goalId = account.goals[0].id;
  });

  afterAll(async () => {
    await app.close();
  });

  const order = (data: { deliveredById?: string; deliveredAt?: Date } = {}) =>
    prisma.materialOrder.create({
      data: {
        reference: 'B-00001',
        storeId,
        accountId,
        goalId,
        status: data.deliveredById ? 'DELIVERED' : 'CONFIRMED',
        total: 10000n,
        createdById: sellerId,
        ...data,
      },
    });

  it('leaves both delivery columns empty until the order is delivered', async () => {
    const confirmed = await order();

    expect(confirmed).toMatchObject({
      status: 'CONFIRMED',
      deliveredById: null,
      deliveredAt: null,
    });
  });

  it('keeps who delivered the order and when', async () => {
    const at = new Date('2026-10-28T10:00:00.000Z');

    const delivered = await order({ deliveredById: sellerId, deliveredAt: at });

    expect(
      await prisma.materialOrder.findUniqueOrThrow({
        where: { id: delivered.id },
        include: { deliveredBy: true },
      }),
    ).toMatchObject({
      status: 'DELIVERED',
      deliveredAt: at,
      deliveredBy: { id: sellerId },
    });
  });

  it('refuses an unknown staff member as the deliverer', async () => {
    await expect(
      order({ deliveredById: randomUUID(), deliveredAt: new Date() }),
    ).rejects.toMatchObject({ code: 'P2003' });
  });

  it('knows the ORDER_DELIVERED notification type', async () => {
    const [row] = await prisma.$queryRaw<{ value: string }[]>`
      SELECT 'ORDER_DELIVERED'::"NotificationType"::text AS value`;

    expect(row.value).toBe('ORDER_DELIVERED');
  });
});
