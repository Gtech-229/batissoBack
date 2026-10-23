import type { INestApplication } from '@nestjs/common';
import type { App } from 'supertest/types.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { createTestApp } from './utils/app.js';
import { createMali, createStoreRecord } from './utils/countries.js';
import { resetDatabase } from './utils/reset-database.js';
import { createUser } from './utils/users.js';

// The catalogue rules the database enforces by itself (migration
// `catalogue_and_prices`), whatever the client of the database.
describe('Catalogue schema (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let storeId: string;
  let otherStoreId: string;
  let categoryId: string;

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
  });

  beforeEach(async () => {
    await resetDatabase(prisma);
    await createMali(prisma);
    storeId = (await createStoreRecord(prisma, { status: 'VERIFIED' })).id;
    otherStoreId = (await createStoreRecord(prisma, { status: 'VERIFIED' })).id;
    categoryId = (
      await prisma.articleCategory.create({ data: { storeId, name: 'Ciment' } })
    ).id;
  });

  afterAll(async () => {
    await app.close();
  });

  const createArticle = (
    data: Partial<{ storeId: string; name: string; currentPrice: bigint }> = {},
  ) =>
    prisma.article.create({
      data: {
        storeId,
        categoryId,
        name: 'Ciment CPA 45',
        unit: 'sac de 50 kg',
        currentPrice: 5000n,
        ...data,
      },
    });

  it('refuses a category name already used by the store, in another case', async () => {
    await expect(
      prisma.articleCategory.create({ data: { storeId, name: 'CIMENT' } }),
    ).rejects.toMatchObject({ code: 'P2002' });
  });

  it('allows the same category name in another store', async () => {
    await expect(
      prisma.articleCategory.create({
        data: { storeId: otherStoreId, name: 'Ciment' },
      }),
    ).resolves.toMatchObject({ name: 'Ciment' });
  });

  it('refuses an article name already used by the store, in another case', async () => {
    await createArticle();

    await expect(
      createArticle({ name: 'ciment cpa 45' }),
    ).rejects.toMatchObject({ code: 'P2002' });
  });

  it.each([0n, -1n])('refuses an article price of %s', async (currentPrice) => {
    await expect(createArticle({ currentPrice })).rejects.toThrow(
      /articles_current_price_positive/,
    );
  });

  it.each([0n, -1n])('refuses a price history row of %s', async (price) => {
    const article = await createArticle();

    await expect(
      prisma.priceHistory.create({ data: { articleId: article.id, price } }),
    ).rejects.toThrow(/price_history_price_positive/);
  });

  it('lets a goal reference an article', async () => {
    const article = await createArticle();
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
      },
    });

    const goal = await prisma.goal.create({
      data: {
        accountId: account.id,
        label: 'Ciment',
        targetAmount: 150000n,
        articleId: article.id,
      },
      include: { article: true },
    });

    expect(goal.article).toMatchObject({ name: 'Ciment CPA 45' });
  });
});
