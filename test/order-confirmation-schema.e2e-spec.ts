import type { INestApplication } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { App } from 'supertest/types.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { createTestApp } from './utils/app.js';
import { createMali, createStoreRecord } from './utils/countries.js';
import { resetDatabase } from './utils/reset-database.js';
import { createUser } from './utils/users.js';

// The confirmation rules the database enforces by itself (migration
// `order_confirmation`), whatever the client of the database.
describe('Order confirmation schema (e2e)', () => {
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

  const debit = (reference: string) =>
    prisma.operation.create({
      data: {
        reference,
        accountId,
        storeId,
        goalId,
        type: 'MATERIAL_DEBIT',
        amount: 10000n,
        direction: 'DEBIT',
        currencyCode: 'XOF',
        balanceBefore: 100000n,
        balanceAfter: 90000n,
        status: 'CONFIRMED',
        authorId: sellerId,
        channel: 'CASH',
        idempotencyKey: randomUUID(),
      },
    });
  const order = (reference: string, operationId: string | null) =>
    prisma.materialOrder.create({
      data: {
        reference,
        storeId,
        accountId,
        goalId,
        status: operationId ? 'CONFIRMED' : 'AWAITING_CUSTOMER',
        total: 10000n,
        createdById: sellerId,
        operationId,
        confirmedVia: operationId ? 'PIN' : null,
      },
    });

  it('links a confirmed order to its debit operation', async () => {
    const operation = await debit('A-00001');

    const confirmed = await order('B-00001', operation.id);

    expect(
      await prisma.materialOrder.findUniqueOrThrow({
        where: { id: confirmed.id },
        include: { operation: true },
      }),
    ).toMatchObject({
      status: 'CONFIRMED',
      confirmedVia: 'PIN',
      operation: { reference: 'A-00001', type: 'MATERIAL_DEBIT' },
    });
  });

  it('refuses two orders on the same debit operation', async () => {
    const operation = await debit('A-00001');
    await order('B-00001', operation.id);

    await expect(order('B-00002', operation.id)).rejects.toMatchObject({
      code: 'P2002',
    });
  });

  it('keeps confirmation codes per order, newest last', async () => {
    const waiting = await order('B-00001', null);
    for (const codeHash of ['first', 'second']) {
      await prisma.orderConfirmationCode.create({
        data: {
          orderId: waiting.id,
          codeHash,
          expiresAt: new Date(Date.now() + 600_000),
          requestedById: sellerId,
        },
      });
    }

    const codes = await prisma.orderConfirmationCode.findMany({
      where: { orderId: waiting.id },
      orderBy: { createdAt: 'asc' },
    });

    expect(codes.map((c) => [c.codeHash, c.attempts, c.consumedAt])).toEqual([
      ['first', 0, null],
      ['second', 0, null],
    ]);
  });

  it('gives increasing values from the purchase reference sequence', async () => {
    const next = async () =>
      (
        await prisma.$queryRaw<{ value: bigint }[]>`
          SELECT nextval('operation_reference_purchase_seq') AS value`
      )[0].value;

    const first = await next();

    expect(await next()).toBe(first + 1n);
  });
});
