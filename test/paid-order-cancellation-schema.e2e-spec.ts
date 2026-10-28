import type { INestApplication } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { App } from 'supertest/types.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { createTestApp } from './utils/app.js';
import { createMali, createStoreRecord } from './utils/countries.js';
import { resetDatabase } from './utils/reset-database.js';
import { createUser } from './utils/users.js';

// The re-credit rules the database enforces by itself (migration
// `paid_order_cancellation`), whatever the client of the database.
describe('Paid order cancellation schema (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let base: {
    accountId: string;
    storeId: string;
    goalId: string;
    authorId: string;
  };
  let debitId: string;
  let depositId: string;
  let sequence = 0;

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
  });

  beforeEach(async () => {
    await resetDatabase(prisma);
    await createMali(prisma);
    const store = await createStoreRecord(prisma, { status: 'VERIFIED' });
    const customer = await createUser(prisma, { phone: '+22376445566' });
    const manager = await createUser(prisma, { phone: '+22376000000' });
    const account = await prisma.account.create({
      data: {
        number: 'C-000001',
        customerId: customer.id,
        storeId: store.id,
        currencyCode: 'XOF',
        termsAcceptedAt: new Date(),
        openedById: manager.id,
        goals: { create: { label: 'Non affecté', isSystem: true } },
      },
      include: { goals: true },
    });
    base = {
      accountId: account.id,
      storeId: store.id,
      goalId: account.goals[0].id,
      authorId: manager.id,
    };
    depositId = (await insert('DEPOSIT', 'CREDIT')).id;
    debitId = (await insert('MATERIAL_DEBIT', 'DEBIT')).id;
  });

  afterAll(async () => {
    await app.close();
  });

  const insert = (
    type: 'DEPOSIT' | 'MATERIAL_DEBIT' | 'CORRECTION',
    direction: 'CREDIT' | 'DEBIT',
    correctedOperationId?: string,
  ) =>
    prisma.operation.create({
      data: {
        ...base,
        reference: `X-${String(++sequence).padStart(5, '0')}`,
        type,
        direction,
        correctedOperationId,
        reason: correctedOperationId ? 'Motif' : undefined,
        amount: 5000n,
        currencyCode: 'XOF',
        balanceBefore: 0n,
        balanceAfter: 5000n,
        status: 'CONFIRMED',
        channel: 'CASH',
        idempotencyKey: randomUUID(),
      },
    });

  it('refuses a second credit correction of the same operation', async () => {
    await insert('CORRECTION', 'CREDIT', debitId);

    await expect(insert('CORRECTION', 'CREDIT', debitId)).rejects.toMatchObject(
      { code: 'P2002' },
    );
  });

  it('still accepts several debit corrections of one deposit', async () => {
    await insert('CORRECTION', 'DEBIT', depositId);
    await insert('CORRECTION', 'DEBIT', depositId);

    expect(
      await prisma.operation.count({
        where: { correctedOperationId: depositId },
      }),
    ).toBe(2);
  });

  it('links an order to its re-credit, at most one order per re-credit', async () => {
    const recredit = await insert('CORRECTION', 'CREDIT', debitId);
    const order = (reference: string) =>
      prisma.materialOrder.create({
        data: {
          reference,
          storeId: base.storeId,
          accountId: base.accountId,
          goalId: base.goalId,
          status: 'CANCELLED_AFTER_DEBIT',
          total: 5000n,
          createdById: base.authorId,
          recreditOperationId: recredit.id,
        },
      });

    const cancelled = await order('B-00001');

    expect(
      await prisma.materialOrder.findUniqueOrThrow({
        where: { id: cancelled.id },
        include: { recreditOperation: true },
      }),
    ).toMatchObject({
      status: 'CANCELLED_AFTER_DEBIT',
      recreditOperation: { id: recredit.id, direction: 'CREDIT' },
    });
    await expect(order('B-00002')).rejects.toMatchObject({ code: 'P2002' });
  });

  it('knows the ORDER_CANCELLATION movement and ORDER_CANCELLED_AFTER_DEBIT notification', async () => {
    const [row] = await prisma.$queryRaw<{ reason: string; type: string }[]>`
      SELECT 'ORDER_CANCELLATION'::"GoalMovementReason"::text AS reason,
             'ORDER_CANCELLED_AFTER_DEBIT'::"NotificationType"::text AS type`;

    expect(row).toEqual({
      reason: 'ORDER_CANCELLATION',
      type: 'ORDER_CANCELLED_AFTER_DEBIT',
    });
  });
});
