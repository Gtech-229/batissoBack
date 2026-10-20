import type { INestApplication } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { App } from 'supertest/types.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { createTestApp } from './utils/app.js';
import { createMali, createStoreRecord } from './utils/countries.js';
import { resetDatabase } from './utils/reset-database.js';
import { createUser } from './utils/users.js';

// The ledger rules the database enforces by itself (migration `ledger`): no
// API code is involved, so they hold for any client of the database.
describe('Ledger schema (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let operation: {
    accountId: string;
    storeId: string;
    goalId: string;
    authorId: string;
  };
  let operationId: string;

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
  });

  beforeEach(async () => {
    await resetDatabase(prisma);
    await createMali(prisma);
    const store = await createStoreRecord(prisma, { status: 'VERIFIED' });
    const customer = await createUser(prisma, { phone: '+22376445566' });
    const seller = await createUser(prisma, { phone: '+22376000001' });
    const account = await prisma.account.create({
      data: {
        number: 'C-000001',
        customerId: customer.id,
        storeId: store.id,
        currencyCode: 'XOF',
        termsAcceptedAt: new Date(),
        openedById: seller.id,
        goals: { create: { label: 'Non affecté', isSystem: true } },
      },
      include: { goals: true },
    });
    operation = {
      accountId: account.id,
      storeId: store.id,
      goalId: account.goals[0].id,
      authorId: seller.id,
    };
    operationId = (await insert(5000n, 'D-00001')).id;
  });

  afterAll(async () => {
    await app.close();
  });

  const insert = (amount: bigint, reference: string) =>
    prisma.operation.create({
      data: {
        ...operation,
        reference,
        type: 'DEPOSIT',
        amount,
        direction: 'CREDIT',
        currencyCode: 'XOF',
        balanceBefore: 0n,
        balanceAfter: amount,
        status: 'CONFIRMED',
        channel: 'CASH',
        idempotencyKey: randomUUID(),
      },
    });
  const stored = () =>
    prisma.operation.findUniqueOrThrow({ where: { id: operationId } });

  it.each([
    [
      'a Prisma update',
      () =>
        prisma.operation.update({
          where: { id: operationId },
          data: { amount: 1n },
        }),
    ],
    [
      'a Prisma updateMany',
      () => prisma.operation.updateMany({ data: { status: 'CANCELLED' } }),
    ],
    [
      'a raw SQL UPDATE',
      () => prisma.$executeRaw`UPDATE "operations" SET "balanceAfter" = 999999`,
    ],
  ])('refuses %s: the operation is unchanged', async (_, change) => {
    await expect(change()).rejects.toThrow(/append-only: UPDATE refused/);

    expect(await stored()).toMatchObject({
      amount: 5000n,
      balanceAfter: 5000n,
      status: 'CONFIRMED',
    });
  });

  it.each([
    [
      'a Prisma delete',
      () => prisma.operation.delete({ where: { id: operationId } }),
    ],
    ['a Prisma deleteMany', () => prisma.operation.deleteMany()],
    ['a raw SQL DELETE', () => prisma.$executeRaw`DELETE FROM "operations"`],
  ])('refuses %s: the operation stays', async (_, remove) => {
    await expect(remove()).rejects.toThrow(/append-only: DELETE refused/);

    expect(await prisma.operation.count()).toBe(1);
  });

  it.each([
    ['zero', 0n],
    ['negative', -500n],
  ])('refuses a %s amount', async (_, amount) => {
    await expect(insert(amount, 'D-00002')).rejects.toThrow(
      /operations_amount_positive/,
    );

    expect(await prisma.operation.count()).toBe(1);
  });

  it('refuses a reused idempotency key or reference', async () => {
    const { idempotencyKey } = await stored();

    await expect(
      prisma.operation.create({
        data: {
          ...operation,
          reference: 'D-00003',
          type: 'DEPOSIT',
          amount: 100n,
          direction: 'CREDIT',
          currencyCode: 'XOF',
          balanceBefore: 0n,
          balanceAfter: 100n,
          status: 'CONFIRMED',
          channel: 'CASH',
          idempotencyKey,
        },
      }),
    ).rejects.toMatchObject({ code: 'P2002' });
    await expect(insert(100n, 'D-00001')).rejects.toMatchObject({
      code: 'P2002',
    });
  });

  it('gives increasing values from operation_reference_deposit_seq', async () => {
    const next = async () =>
      (
        await prisma.$queryRaw<{ value: bigint }[]>`
          SELECT nextval('operation_reference_deposit_seq') AS value
        `
      )[0].value;

    const first = await next();

    expect(await next()).toBe(first + 1n);
  });

  it('starts every goal balance at 0', async () => {
    const goal = await prisma.goal.findUniqueOrThrow({
      where: { id: operation.goalId },
    });

    expect(goal.balance).toBe(0n);
  });
});
