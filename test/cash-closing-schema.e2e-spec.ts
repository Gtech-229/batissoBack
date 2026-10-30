import type { INestApplication } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { App } from 'supertest/types.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { createTestApp } from './utils/app.js';
import { createMali, createStoreRecord } from './utils/countries.js';
import { resetDatabase } from './utils/reset-database.js';
import { createUser } from './utils/users.js';

// The closing rules the database enforces by itself (migration `cash_closing`),
// whatever the client of the database.
describe('Cash closing schema (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let storeId: string;
  let managerId: string;
  let operationId: string;

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
  });

  beforeEach(async () => {
    await resetDatabase(prisma);
    await createMali(prisma);
    storeId = (await createStoreRecord(prisma, { status: 'VERIFIED' })).id;
    managerId = (await createUser(prisma, { phone: '+22376000000' })).id;
    const customer = await createUser(prisma, { phone: '+22376445566' });
    const account = await prisma.account.create({
      data: {
        number: 'C-000001',
        customerId: customer.id,
        storeId,
        currencyCode: 'XOF',
        termsAcceptedAt: new Date(),
        openedById: managerId,
        goals: { create: { label: 'Non affecté', isSystem: true } },
      },
      include: { goals: true },
    });
    operationId = (
      await prisma.operation.create({
        data: {
          reference: 'D-00001',
          accountId: account.id,
          storeId,
          goalId: account.goals[0].id,
          type: 'DEPOSIT',
          amount: 5000n,
          direction: 'CREDIT',
          currencyCode: 'XOF',
          balanceBefore: 0n,
          balanceAfter: 5000n,
          status: 'CONFIRMED',
          channel: 'CASH',
          authorId: managerId,
          idempotencyKey: randomUUID(),
        },
      })
    ).id;
  });

  afterAll(async () => {
    await app.close();
  });

  const closing = (
    data: Partial<{
      depositsTotal: bigint;
      correctionsTotal: bigint;
      expectedTotal: bigint;
      countedTotal: bigint;
      discrepancy: bigint;
      justification: string;
    }> = {},
  ) =>
    prisma.cashClosing.create({
      data: {
        storeId,
        managerId,
        currencyCode: 'XOF',
        depositsTotal: 5000n,
        correctionsTotal: 1000n,
        expectedTotal: 4000n,
        countedTotal: 4000n,
        discrepancy: 0n,
        idempotencyKey: randomUUID(),
        ...data,
      },
    });

  it('stores a closing whose arithmetic holds', async () => {
    await expect(closing()).resolves.toMatchObject({ discrepancy: 0n });
  });

  it('accepts a negative expected total and a justified difference', async () => {
    await expect(
      closing({
        depositsTotal: 0n,
        correctionsTotal: 1000n,
        expectedTotal: -1000n,
        countedTotal: 0n,
        discrepancy: 1000n,
        justification: 'Dépôt d’hier corrigé',
      }),
    ).resolves.toMatchObject({ expectedTotal: -1000n, discrepancy: 1000n });
  });

  it.each([
    [
      'a wrong expected total',
      { expectedTotal: 3000n, discrepancy: 1000n, justification: 'x' },
      'expected_check',
    ],
    ['a wrong discrepancy', { discrepancy: 500n }, 'discrepancy_check'],
    [
      'a negative count',
      { countedTotal: -1n, discrepancy: -4001n, justification: 'x' },
      'amounts_not_negative',
    ],
    [
      'a difference without a justification',
      { countedTotal: 3500n, discrepancy: -500n },
      'justified',
    ],
  ])('refuses %s', async (_, data, check) => {
    await expect(closing(data)).rejects.toThrow(`cash_closings_${check}`);
  });

  it('counts an operation in one closing only', async () => {
    const first = await closing();
    const second = await closing();
    await prisma.cashClosingOperation.create({
      data: { closingId: first.id, operationId },
    });

    await expect(
      prisma.cashClosingOperation.create({
        data: { closingId: second.id, operationId },
      }),
    ).rejects.toMatchObject({ code: 'P2002' });
  });

  it('keeps a closing and its links final', async () => {
    const stored = await closing();
    await prisma.cashClosingOperation.create({
      data: { closingId: stored.id, operationId },
    });

    await expect(
      prisma.cashClosing.update({
        where: { id: stored.id },
        data: { justification: 'Après coup' },
      }),
    ).rejects.toThrow(/append-only: UPDATE refused/);
    await expect(
      prisma.cashClosing.delete({ where: { id: stored.id } }),
    ).rejects.toThrow(/append-only: DELETE refused/);
    await expect(
      prisma.cashClosingOperation.delete({ where: { operationId } }),
    ).rejects.toThrow(/append-only: DELETE refused/);
  });
});
