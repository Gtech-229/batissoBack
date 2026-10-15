import type { INestApplication } from '@nestjs/common';
import type { App } from 'supertest/types.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { createTestApp } from './utils/app.js';
import { createMali, createStoreRecord } from './utils/countries.js';
import { resetDatabase } from './utils/reset-database.js';
import { createUser } from './utils/users.js';

// The database rules Prisma's schema cannot declare (migration customer_accounts).
describe('Accounts schema (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let accountId: string;

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
    });
    accountId = account.id;
  });

  afterAll(async () => {
    await app.close();
  });

  it('refuses a second system goal on the same account', async () => {
    await expect(
      prisma.goal.create({
        data: { accountId, label: 'Autre', isSystem: true },
      }),
    ).rejects.toMatchObject({ code: 'P2002' });
  });

  it('allows any number of ordinary goals next to the system goal', async () => {
    await prisma.goal.createMany({
      data: [
        { accountId, label: 'Ciment', targetAmount: 150000n },
        { accountId, label: 'Fer', targetAmount: 90000n },
      ],
    });

    expect(await prisma.goal.count({ where: { accountId } })).toBe(3);
  });

  it('gives increasing values from account_number_seq', async () => {
    const next = async () =>
      (
        await prisma.$queryRaw<{ value: bigint }[]>`
          SELECT nextval('account_number_seq') AS value
        `
      )[0].value;

    const first = await next();
    const second = await next();

    expect(typeof first).toBe('bigint');
    expect(second).toBe(first + 1n);
  });
});
