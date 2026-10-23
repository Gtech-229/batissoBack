import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { createTestApp } from './utils/app.js';
import { createMali, createStoreRecord } from './utils/countries.js';
import { resetDatabase } from './utils/reset-database.js';
import { signedInStaff, type MobileStaff } from './utils/staff.js';

describe('Article prices (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let storeId: string;
  let otherStoreId: string;
  let manager: MobileStaff;
  let seller: MobileStaff;
  let outsider: MobileStaff;
  let articleId: string;

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
  });

  beforeEach(async () => {
    await resetDatabase(prisma);
    await createMali(prisma);
    storeId = (await createStoreRecord(prisma, { status: 'VERIFIED' })).id;
    otherStoreId = (await createStoreRecord(prisma, { status: 'VERIFIED' })).id;
    manager = await signedInStaff(app, prisma, {
      phone: '+22376000000',
      store: { id: storeId, role: 'MANAGER' },
    });
    seller = await signedInStaff(app, prisma, {
      phone: '+22376000001',
      store: { id: storeId, role: 'SELLER' },
    });
    outsider = await signedInStaff(app, prisma, {
      phone: '+22376000002',
      store: { id: otherStoreId, role: 'MANAGER' },
    });
    const categoryId = (
      await prisma.articleCategory.create({ data: { storeId, name: 'Ciment' } })
    ).id;
    articleId = (
      await api()
        .post(`/api/v1/stores/${storeId}/articles`)
        .set('Authorization', manager.authorization)
        .send({
          name: 'Ciment CPA 45',
          categoryId,
          unit: 'sac de 50 kg',
          price: '5000',
        })
        .expect(201)
    ).body.id as string;
  });

  afterAll(async () => {
    await app.close();
  });

  const api = () => request(app.getHttpServer());
  const pricesUrl = (id = articleId) =>
    `/api/v1/stores/${storeId}/articles/${id}/prices`;
  const changePrice = (price: unknown, as = manager, id = articleId) =>
    api()
      .post(pricesUrl(id))
      .set('Authorization', as.authorization)
      .send({ price });
  const history = (as = seller, query: Record<string, string> = {}) =>
    api().get(pricesUrl()).query(query).set('Authorization', as.authorization);
  const prices = (body: { items: { price: string }[] }) =>
    body.items.map((entry) => entry.price);

  describe('POST /stores/:storeId/articles/:articleId/prices', () => {
    it('changes the price of the day at once, adds it to the history, and logs it', async () => {
      const before = Date.now();

      const response = await changePrice('5500').expect(201);

      expect(response.body).toMatchObject({
        id: articleId,
        currentPrice: '5500',
        currencyCode: 'XOF',
      });
      const newest = await prisma.priceHistory.findFirstOrThrow({
        where: { articleId },
        orderBy: { startsAt: 'desc' },
      });
      expect(newest.price).toBe(5500n);
      expect(newest.startsAt.getTime()).toBeGreaterThanOrEqual(before - 1000);
      expect(
        await prisma.activityLog.findFirstOrThrow({
          where: { action: 'ARTICLE_PRICE_CHANGED' },
        }),
      ).toMatchObject({
        storeId,
        userId: manager.userId,
        device: manager.deviceId,
        oldValue: { articleId, price: '5000' },
        newValue: { articleId, price: '5500' },
      });
    });

    it('refuses the current price with 409 PRICE_UNCHANGED', async () => {
      const response = await changePrice('5000').expect(409);

      expect(response.body).toMatchObject({
        error: 'PRICE_UNCHANGED',
        message: 'Le prix du jour est déjà 5000 XOF',
      });
      expect(await prisma.priceHistory.count()).toBe(1);
    });

    it('keeps the current price equal to the newest history row under parallel changes', async () => {
      const responses = await Promise.all(
        ['5100', '5200', '5300', '5400'].map((price) => changePrice(price)),
      );

      expect(responses.map((r) => r.status)).toEqual([201, 201, 201, 201]);
      const article = await prisma.article.findUniqueOrThrow({
        where: { id: articleId },
        include: {
          prices: { orderBy: [{ startsAt: 'desc' }, { id: 'desc' }] },
        },
      });
      expect(article.prices).toHaveLength(5);
      expect(article.prices[0].price).toBe(article.currentPrice);
    });

    it.each([
      ['a zero price', '0'],
      ['a negative price', '-5000'],
      ['a numeric price', 5000],
      ['a missing price', undefined],
    ])('refuses %s with a French 400', async (_, price) => {
      const response = await changePrice(price).expect(400);

      expect(response.body.details).toContainEqual(
        expect.objectContaining({ field: 'price' }),
      );
    });

    it('refuses a seller with 403 and a member of another store with 404', async () => {
      await changePrice('5500', seller)
        .expect(403)
        .expect((r) => expect(r.body.error).toBe('STORE_ROLE_REQUIRED'));
      await api()
        .post(pricesUrl())
        .set('Authorization', outsider.authorization)
        .send({ price: '5500' })
        .expect(404);
      expect(await prisma.priceHistory.count()).toBe(1);
    });

    it('answers 404 for an unknown article', async () => {
      await changePrice('5500', manager, '0192f0a4-7b1c-7c3e-9d2a-5e6f7a8b9c0d')
        .expect(404)
        .expect((r) => expect(r.body.message).toBe('Article introuvable'));
    });

    it('refuses a closed store with 409 STORE_CLOSED', async () => {
      await prisma.hardwareStore.update({
        where: { id: storeId },
        data: { status: 'CLOSED' },
      });

      await changePrice('5500')
        .expect(409)
        .expect((r) => expect(r.body.error).toBe('STORE_CLOSED'));
    });

    it('changes the price of an article not on sale', async () => {
      await prisma.article.update({
        where: { id: articleId },
        data: { available: false },
      });

      await changePrice('5500').expect(201);
    });
  });

  describe('GET /stores/:storeId/articles/:articleId/prices', () => {
    it('lists every price since creation, newest first, to managers and sellers', async () => {
      await changePrice('5500').expect(201);
      await changePrice('5200').expect(201);

      for (const as of [manager, seller]) {
        const response = await history(as).expect(200);

        expect(response.body).toMatchObject({
          total: 3,
          page: 1,
          pageSize: 20,
        });
        expect(prices(response.body)).toEqual(['5200', '5500', '5000']);
        expect(response.body.items[0]).toEqual({
          id: expect.any(String),
          price: '5200',
          startsAt: expect.any(String),
        });
      }
    });

    it('paginates', async () => {
      await changePrice('5500').expect(201);

      const response = await history(seller, {
        page: '2',
        pageSize: '1',
      }).expect(200);

      expect(response.body).toMatchObject({ total: 2, page: 2, pageSize: 1 });
      expect(prices(response.body)).toEqual(['5000']);
    });

    it('answers 404 for an article of another store', async () => {
      await api()
        .get(pricesUrl())
        .set('Authorization', outsider.authorization)
        .expect(404);
      await api()
        .get(`/api/v1/stores/${otherStoreId}/articles/${articleId}/prices`)
        .set('Authorization', outsider.authorization)
        .expect(404)
        .expect((r) => expect(r.body.message).toBe('Article introuvable'));
    });
  });
});
