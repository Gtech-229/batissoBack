import type { INestApplication } from '@nestjs/common';
import type { App } from 'supertest/types.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { createTestApp } from './utils/app.js';
import { createMali, createStoreRecord } from './utils/countries.js';
import { resetDatabase } from './utils/reset-database.js';
import { createUser } from './utils/users.js';

// The order rules the database enforces by itself (migration
// `material_orders`), whatever the client of the database.
describe('Material orders schema (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let storeId: string;
  let accountId: string;
  let goalId: string;
  let sellerId: string;
  let articleId: string;

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
        termsAcceptedAt: new Date(),
        openedById: sellerId,
        goals: { create: { label: 'Non affecté', isSystem: true } },
      },
      include: { goals: true },
    });
    accountId = account.id;
    goalId = account.goals[0].id;
    const category = await prisma.articleCategory.create({
      data: { storeId, name: 'Ciment' },
    });
    articleId = (
      await prisma.article.create({
        data: {
          storeId,
          categoryId: category.id,
          name: 'Ciment CPA 45',
          unit: 'sac de 50 kg',
          currentPrice: 5000n,
        },
      })
    ).id;
  });

  afterAll(async () => {
    await app.close();
  });

  const createOrder = (total = 10000n, reference = 'B-00001') =>
    prisma.materialOrder.create({
      data: {
        reference,
        storeId,
        accountId,
        goalId,
        status: 'AWAITING_CUSTOMER',
        total,
        createdById: sellerId,
      },
    });
  const createLine = (
    orderId: string,
    data: Partial<{ quantity: number; unitPrice: bigint }> = {},
  ) =>
    prisma.materialOrderLine.create({
      data: {
        orderId,
        articleId,
        articleName: 'Ciment CPA 45',
        unit: 'sac de 50 kg',
        quantity: 2,
        unitPrice: 5000n,
        ...data,
      },
    });

  it.each([0n, -1n])('refuses an order total of %s', async (total) => {
    await expect(createOrder(total)).rejects.toThrow(
      /material_orders_total_positive/,
    );
  });

  it.each([0, -1])('refuses a line quantity of %s', async (quantity) => {
    const order = await createOrder();

    await expect(createLine(order.id, { quantity })).rejects.toThrow(
      /material_order_lines_quantity_positive/,
    );
  });

  it.each([0n, -1n])('refuses a line unit price of %s', async (unitPrice) => {
    const order = await createOrder();

    await expect(createLine(order.id, { unitPrice })).rejects.toThrow(
      /material_order_lines_unit_price_positive/,
    );
  });

  it('refuses the same article twice in one order', async () => {
    const order = await createOrder();
    await createLine(order.id);

    await expect(createLine(order.id)).rejects.toMatchObject({
      code: 'P2002',
    });
  });

  it('refuses a reference already used', async () => {
    await createOrder();

    await expect(createOrder(10000n, 'B-00001')).rejects.toMatchObject({
      code: 'P2002',
    });
  });

  it('gives increasing values from the reference sequence', async () => {
    const next = async () =>
      (
        await prisma.$queryRaw<{ value: bigint }[]>`
          SELECT nextval('material_order_reference_seq') AS value`
      )[0].value;

    const first = await next();
    const second = await next();

    expect(second).toBe(first + 1n);
  });
});
