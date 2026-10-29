import type { INestApplication } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { App } from 'supertest/types.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { createTestApp } from './utils/app.js';
import { createMali, createStoreRecord } from './utils/countries.js';
import { resetDatabase } from './utils/reset-database.js';
import { createUser } from './utils/users.js';

// The dispute rules the database enforces by itself (migration `disputes`),
// whatever the client of the database.
describe('Disputes schema (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let base: {
    operationId: string;
    accountId: string;
    storeId: string;
    openedById: string;
  };

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
    const operation = await prisma.operation.create({
      data: {
        reference: 'D-00001',
        accountId: account.id,
        storeId: store.id,
        goalId: account.goals[0].id,
        type: 'DEPOSIT',
        amount: 5000n,
        direction: 'CREDIT',
        currencyCode: 'XOF',
        balanceBefore: 0n,
        balanceAfter: 5000n,
        status: 'CONFIRMED',
        channel: 'CASH',
        authorId: seller.id,
        idempotencyKey: randomUUID(),
      },
    });
    base = {
      operationId: operation.id,
      accountId: account.id,
      storeId: store.id,
      openedById: customer.id,
    };
  });

  afterAll(async () => {
    await app.close();
  });

  const dispute = (status: 'OPEN' | 'ANSWERED' | 'CLOSED' = 'OPEN') =>
    prisma.dispute.create({ data: { ...base, status } });
  const message = (disputeId: string, body = 'Je n’ai pas versé ce montant') =>
    prisma.disputeMessage.create({
      data: { disputeId, author: 'CUSTOMER', authorId: base.openedById, body },
    });

  it('refuses a second dispute on an operation while one is not closed', async () => {
    await dispute('ANSWERED');

    await expect(dispute()).rejects.toMatchObject({ code: 'P2002' });
  });

  it('accepts a new dispute on the operation once the previous one is closed', async () => {
    await dispute('CLOSED');
    await dispute('CLOSED');

    await expect(dispute()).resolves.toMatchObject({ status: 'OPEN' });
  });

  it('keeps the thread append-only', async () => {
    const opened = await dispute();
    const written = await message(opened.id);

    await expect(
      prisma.disputeMessage.update({
        where: { id: written.id },
        data: { body: 'Autre texte' },
      }),
    ).rejects.toThrow(/append-only: UPDATE refused/);
    await expect(
      prisma.disputeMessage.delete({ where: { id: written.id } }),
    ).rejects.toThrow(/append-only: DELETE refused/);
    expect(
      await prisma.disputeMessage.findUniqueOrThrow({
        where: { id: written.id },
      }),
    ).toMatchObject({ body: 'Je n’ai pas versé ce montant' });
  });

  it('refuses a blank message', async () => {
    const opened = await dispute();

    await expect(message(opened.id, '   ')).rejects.toThrow(
      /dispute_messages_body_not_blank/,
    );
  });

  it('knows the four dispute notification types', async () => {
    const rows = await prisma.$queryRaw<{ value: string }[]>`
      SELECT unnest(ARRAY[
        'DISPUTE_OPENED', 'DISPUTE_CUSTOMER_MESSAGE',
        'DISPUTE_STORE_REPLY', 'DISPUTE_CLOSED'
      ]::"NotificationType"[])::text AS value`;

    expect(rows.map((row) => row.value)).toEqual([
      'DISPUTE_OPENED',
      'DISPUTE_CUSTOMER_MESSAGE',
      'DISPUTE_STORE_REPLY',
      'DISPUTE_CLOSED',
    ]);
  });
});
