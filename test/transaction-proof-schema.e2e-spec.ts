import type { INestApplication } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { App } from 'supertest/types.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { createTestApp } from './utils/app.js';
import { createMali, createStoreRecord } from './utils/countries.js';
import { resetDatabase } from './utils/reset-database.js';
import { createUser } from './utils/users.js';

const FILE = '0192f0a4-7b1c-7c3e-9d2a-5e6f7a8b9c0d.jpg';

// The proof rules the database enforces by itself (migration `transaction_proof`).
describe('Transaction proof schema (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let storeId: string;
  let accountId: string;
  let userId: string;
  let operationId: string;
  let orderId: string;

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
  });

  beforeEach(async () => {
    await resetDatabase(prisma);
    await createMali(prisma);
    storeId = (await createStoreRecord(prisma, { status: 'VERIFIED' })).id;
    userId = (await createUser(prisma, { phone: '+22376000000' })).id;
    const customer = await createUser(prisma, { phone: '+22376445566' });
    const account = await prisma.account.create({
      data: {
        number: 'C-000001',
        customerId: customer.id,
        storeId,
        currencyCode: 'XOF',
        termsAcceptedAt: new Date(),
        openedById: userId,
        goals: { create: { label: 'Non affecté', isSystem: true } },
      },
      include: { goals: true },
    });
    accountId = account.id;
    operationId = (
      await prisma.operation.create({
        data: {
          reference: 'D-00001',
          accountId,
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
          authorId: userId,
          idempotencyKey: randomUUID(),
        },
      })
    ).id;
    orderId = (
      await prisma.materialOrder.create({
        data: {
          reference: 'B-00001',
          storeId,
          accountId,
          goalId: account.goals[0].id,
          total: 1000n,
          status: 'AWAITING_CUSTOMER',
          createdById: userId,
        },
      })
    ).id;
  });

  afterAll(async () => {
    await app.close();
  });

  const proof = (data: object) =>
    prisma.transactionProof.create({
      data: {
        storeId,
        accountId,
        uploadedById: userId,
        fileName: FILE,
        ...data,
      },
    });

  it('accepts a proof on a deposit or on an order', async () => {
    await expect(proof({ operationId })).resolves.toBeDefined();
    await expect(proof({ orderId })).resolves.toBeDefined();
  });

  it('refuses a proof with no target, or with both', async () => {
    await expect(proof({})).rejects.toThrow('transaction_proofs_one_target');
    await expect(proof({ operationId, orderId })).rejects.toThrow(
      'transaction_proofs_one_target',
    );
  });

  it('keeps the row of a removed proof, with no file name', async () => {
    const stored = await proof({ operationId });

    await expect(
      prisma.transactionProof.update({
        where: { id: stored.id },
        data: {
          fileName: null,
          removedAt: new Date(),
          removedById: userId,
          removalReason: 'Mauvaise photo',
        },
      }),
    ).resolves.toMatchObject({ fileName: null });
  });

  it.each([
    ['no reason', { removedById: true, removalReason: null }],
    ['no author', { removedById: false, removalReason: 'Erreur' }],
  ])('refuses a removal with %s', async (_, removal) => {
    const stored = await proof({ operationId });

    await expect(
      prisma.transactionProof.update({
        where: { id: stored.id },
        data: {
          fileName: null,
          removedAt: new Date(),
          removedById: removal.removedById ? userId : null,
          removalReason: removal.removalReason,
        },
      }),
    ).rejects.toThrow('transaction_proofs_removal');
  });

  it('refuses a removal that keeps the file name', async () => {
    const stored = await proof({ operationId });

    await expect(
      prisma.transactionProof.update({
        where: { id: stored.id },
        data: {
          removedAt: new Date(),
          removedById: userId,
          removalReason: 'Erreur',
        },
      }),
    ).rejects.toThrow('transaction_proofs_removal');
  });

  it('refuses a live proof with no file name', async () => {
    await expect(proof({ operationId, fileName: null })).rejects.toThrow(
      'transaction_proofs_removal',
    );
  });
});
