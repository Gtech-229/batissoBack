import type { INestApplication } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { App } from 'supertest/types.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { createTestApp } from './utils/app.js';
import { createMali, createStoreRecord } from './utils/countries.js';
import { resetDatabase } from './utils/reset-database.js';
import { createUser } from './utils/users.js';

// The correction rules the database enforces by itself (migration
// `corrections`), whatever the client of the database.
describe('Corrections schema (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let base: {
    accountId: string;
    storeId: string;
    goalId: string;
    authorId: string;
  };
  let depositId: string;

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
    depositId = (
      await insert({
        reference: 'D-00001',
        type: 'DEPOSIT',
        direction: 'CREDIT',
      })
    ).id;
  });

  afterAll(async () => {
    await app.close();
  });

  const insert = (data: {
    reference: string;
    type: 'DEPOSIT' | 'CORRECTION';
    direction: 'CREDIT' | 'DEBIT';
    correctedOperationId?: string;
    reason?: string;
  }) =>
    prisma.operation.create({
      data: {
        ...base,
        ...data,
        amount: 5000n,
        currencyCode: 'XOF',
        balanceBefore: 0n,
        balanceAfter: 5000n,
        status: 'CONFIRMED',
        channel: 'CASH',
        idempotencyKey: randomUUID(),
      },
    });
  const correction = (data: {
    correctedOperationId?: string;
    reason?: string;
  }) =>
    insert({
      reference: 'R-00001',
      type: 'CORRECTION',
      direction: 'DEBIT',
      ...data,
    });
  const CHECK_REFUSED = /operations_correction_link_check/;

  it('stores a correction linked to its deposit, with a reason', async () => {
    const stored = await correction({
      correctedOperationId: depositId,
      reason: 'Erreur de saisie',
    });

    expect(
      await prisma.operation.findUniqueOrThrow({
        where: { id: stored.id },
        include: { correctedOperation: true },
      }),
    ).toMatchObject({
      type: 'CORRECTION',
      reason: 'Erreur de saisie',
      correctedOperation: { reference: 'D-00001' },
    });
  });

  it('refuses a correction without the operation it fixes', async () => {
    await expect(correction({ reason: 'Erreur' })).rejects.toThrow(
      CHECK_REFUSED,
    );
  });

  it('refuses a correction without a reason', async () => {
    await expect(
      correction({ correctedOperationId: depositId }),
    ).rejects.toThrow(CHECK_REFUSED);
  });

  it('refuses a deposit linked to a corrected operation', async () => {
    await expect(
      insert({
        reference: 'D-00002',
        type: 'DEPOSIT',
        direction: 'CREDIT',
        correctedOperationId: depositId,
      }),
    ).rejects.toThrow(CHECK_REFUSED);
  });

  it('keeps a correction append-only, like every operation', async () => {
    const stored = await correction({
      correctedOperationId: depositId,
      reason: 'Erreur de saisie',
    });

    await expect(
      prisma.operation.update({
        where: { id: stored.id },
        data: { reason: 'Autre motif' },
      }),
    ).rejects.toThrow(/append-only: UPDATE refused/);
  });

  it('gives increasing values from the correction reference sequence', async () => {
    const next = async () =>
      (
        await prisma.$queryRaw<{ value: bigint }[]>`
          SELECT nextval('operation_reference_correction_seq') AS value`
      )[0].value;

    const first = await next();

    expect(await next()).toBe(first + 1n);
  });
});
