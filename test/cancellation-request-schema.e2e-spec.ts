import type { INestApplication } from '@nestjs/common';
import type { App } from 'supertest/types.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { createTestApp } from './utils/app.js';
import { createMali, createStoreRecord } from './utils/countries.js';
import { resetDatabase } from './utils/reset-database.js';
import { createUser } from './utils/users.js';

// The cancellation-request rules the database holds by itself (migration
// `cancellation_request`), whatever the client of the database.
describe('Cancellation request schema (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let storeId: string;

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
  });

  beforeEach(async () => {
    await resetDatabase(prisma);
    await createMali(prisma);
    storeId = (await createStoreRecord(prisma, { status: 'VERIFIED' })).id;
  });

  afterAll(async () => {
    await app.close();
  });

  const setDelay = (deliveryDelayDays: number) =>
    prisma.storeSettings.update({
      where: { storeId },
      data: { deliveryDelayDays },
    });
  const CHECK_REFUSED = /store_settings_delivery_delay_check/;

  it('gives every store a 30-day delivery delay by default', async () => {
    expect(
      await prisma.storeSettings.findUniqueOrThrow({ where: { storeId } }),
    ).toMatchObject({ deliveryDelayDays: 30 });
  });

  it('keeps the delay between 1 and 365 days', async () => {
    await setDelay(1);
    await setDelay(365);

    await expect(setDelay(0)).rejects.toThrow(CHECK_REFUSED);
    await expect(setDelay(366)).rejects.toThrow(CHECK_REFUSED);
  });

  it('leaves an order without a cancellation request by default', async () => {
    const customer = await createUser(prisma, { phone: '+22376445566' });
    const seller = await createUser(prisma, { phone: '+22376000001' });
    const account = await prisma.account.create({
      data: {
        number: 'C-000001',
        customerId: customer.id,
        storeId,
        currencyCode: 'XOF',
        termsAcceptedAt: new Date(),
        openedById: seller.id,
        goals: { create: { label: 'Non affecté', isSystem: true } },
      },
      include: { goals: true },
    });

    const order = await prisma.materialOrder.create({
      data: {
        reference: 'B-00001',
        storeId,
        accountId: account.id,
        goalId: account.goals[0].id,
        status: 'CONFIRMED',
        total: 10000n,
        createdById: seller.id,
      },
    });

    expect(order).toMatchObject({
      cancellationRequestedAt: null,
      cancellationRequestReason: null,
    });
  });

  it('knows the ORDER_CANCELLATION_REQUESTED notification type', async () => {
    const [row] = await prisma.$queryRaw<{ value: string }[]>`
      SELECT 'ORDER_CANCELLATION_REQUESTED'::"NotificationType"::text AS value`;

    expect(row.value).toBe('ORDER_CANCELLATION_REQUESTED');
  });
});
