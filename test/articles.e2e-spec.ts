import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { createTestApp } from './utils/app.js';
import { createMali, createStoreRecord } from './utils/countries.js';
import { resetDatabase } from './utils/reset-database.js';
import { signedInStaff, type MobileStaff } from './utils/staff.js';

describe('Articles (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let storeId: string;
  let otherStoreId: string;
  let manager: MobileStaff;
  let seller: MobileStaff;
  let outsider: MobileStaff;
  let cementId: string;
  let paintId: string;
  let foreignCategoryId: string;

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
    cementId = await category(storeId, 'Ciment');
    paintId = await category(storeId, 'Peinture');
    foreignCategoryId = await category(otherStoreId, 'Ciment');
  });

  afterAll(async () => {
    await app.close();
  });

  const api = () => request(app.getHttpServer());
  const category = async (store: string, name: string) =>
    (await prisma.articleCategory.create({ data: { storeId: store, name } }))
      .id;
  const articlesUrl = (store = storeId) => `/api/v1/stores/${store}/articles`;
  const cement = (overrides: Record<string, unknown> = {}) => ({
    name: 'Ciment CPA 45',
    categoryId: cementId,
    unit: 'sac de 50 kg',
    price: '5000',
    ...overrides,
  });
  const create = (body: Record<string, unknown>, as = manager) =>
    api().post(articlesUrl()).set('Authorization', as.authorization).send(body);
  const update = (
    articleId: string,
    body: Record<string, unknown>,
    as = manager,
  ) =>
    api()
      .patch(`${articlesUrl()}/${articleId}`)
      .set('Authorization', as.authorization)
      .send(body);
  const list = (query: Record<string, string> = {}, as = seller) =>
    api()
      .get(articlesUrl())
      .query(query)
      .set('Authorization', as.authorization);
  const names = (body: { items: { name: string }[] }) =>
    body.items.map((item) => item.name);

  describe('POST /stores/:storeId/articles', () => {
    it('creates an article with its first price history row, and logs it', async () => {
      const response = await create(
        cement({ name: '  Ciment CPA 45 ', unit: ' sac de 50 kg ' }),
      ).expect(201);

      expect(response.body).toEqual({
        id: expect.any(String),
        name: 'Ciment CPA 45',
        category: { id: cementId, name: 'Ciment' },
        unit: 'sac de 50 kg',
        currentPrice: '5000',
        currencyCode: 'XOF',
        available: true,
        createdAt: expect.any(String),
        updatedAt: expect.any(String),
      });
      expect(
        await prisma.priceHistory.findMany({
          where: { articleId: response.body.id },
        }),
      ).toEqual([expect.objectContaining({ price: 5000n })]);
      expect(
        await prisma.activityLog.findFirstOrThrow({
          where: { action: 'ARTICLE_CREATED' },
        }),
      ).toMatchObject({
        storeId,
        userId: manager.userId,
        device: manager.deviceId,
        newValue: {
          articleId: response.body.id,
          name: 'Ciment CPA 45',
          categoryId: cementId,
          unit: 'sac de 50 kg',
          price: '5000',
          available: true,
        },
      });
    });

    it('dates the first price with the API clock, like every later price change (F-04)', async () => {
      // The e2e app runs in this process: Date.now() here is the API's clock.
      const before = Date.now();
      const response = await create(cement()).expect(201);
      const after = Date.now();

      const [first] = await prisma.priceHistory.findMany({
        where: { articleId: response.body.id },
      });
      expect(first.startsAt.getTime()).toBeGreaterThanOrEqual(before);
      expect(first.startsAt.getTime()).toBeLessThanOrEqual(after);
    });

    it('creates an article not yet on sale', async () => {
      const response = await create(cement({ available: false })).expect(201);

      expect(response.body.available).toBe(false);
    });

    it('refuses a name the store already uses, in another case, with 409 ARTICLE_EXISTS', async () => {
      await create(cement()).expect(201);

      const response = await create(cement({ name: 'CIMENT cpa 45' })).expect(
        409,
      );

      expect(response.body).toMatchObject({
        error: 'ARTICLE_EXISTS',
        message: 'Cette quincaillerie a déjà un article de ce nom',
      });
      expect(await prisma.priceHistory.count()).toBe(1);
    });

    it('answers 404 for a category of another store', async () => {
      await create(cement({ categoryId: foreignCategoryId }))
        .expect(404)
        .expect((r) => expect(r.body.message).toBe('Catégorie introuvable'));
      expect(await prisma.article.count()).toBe(0);
    });

    it.each([
      ['a zero price', { price: '0' }, 'price'],
      ['a numeric price', { price: 5000 }, 'price'],
      ['a decimal price', { price: '5000.5' }, 'price'],
      ['an empty name', { name: ' ' }, 'name'],
      ['a long unit', { unit: 'x'.repeat(51) }, 'unit'],
      ['a malformed category id', { categoryId: 'c-1' }, 'categoryId'],
      ['a text availability', { available: 'yes' }, 'available'],
    ])('refuses %s with a French 400', async (_, overrides, field) => {
      const response = await create(cement(overrides)).expect(400);

      expect(response.body.details).toContainEqual(
        expect.objectContaining({ field }),
      );
    });

    it('refuses a seller with 403 STORE_ROLE_REQUIRED', async () => {
      await create(cement(), seller)
        .expect(403)
        .expect((r) => expect(r.body.error).toBe('STORE_ROLE_REQUIRED'));
    });

    it('answers 404 to a member of another store', async () => {
      await create(cement(), outsider).expect(404);
    });

    it('refuses a closed store with 409 STORE_CLOSED', async () => {
      await prisma.hardwareStore.update({
        where: { id: storeId },
        data: { status: 'CLOSED' },
      });

      await create(cement())
        .expect(409)
        .expect((r) => expect(r.body.error).toBe('STORE_CLOSED'));
    });
  });

  describe('GET /stores/:storeId/articles', () => {
    beforeEach(async () => {
      await create(cement()).expect(201);
      await create(cement({ name: 'Ciment blanc', price: '9000' })).expect(201);
      await create(
        cement({
          name: 'Peinture 100% acrylique',
          categoryId: paintId,
          unit: 'pot de 20 L',
          available: false,
        }),
      ).expect(201);
      await api()
        .post(articlesUrl(otherStoreId))
        .set('Authorization', outsider.authorization)
        .send(cement({ categoryId: foreignCategoryId }))
        .expect(201);
    });

    it('lists the store’s articles by name, to managers and sellers', async () => {
      for (const as of [manager, seller]) {
        const response = await list({}, as).expect(200);

        expect(response.body).toMatchObject({
          total: 3,
          page: 1,
          pageSize: 20,
        });
        expect(names(response.body)).toEqual([
          'Ciment blanc',
          'Ciment CPA 45',
          'Peinture 100% acrylique',
        ]);
      }
    });

    it('filters by category and by availability', async () => {
      expect(
        names((await list({ categoryId: paintId }).expect(200)).body),
      ).toEqual(['Peinture 100% acrylique']);
      expect(
        names((await list({ available: 'true' }).expect(200)).body),
      ).toEqual(['Ciment blanc', 'Ciment CPA 45']);
      expect(
        names((await list({ available: 'false' }).expect(200)).body),
      ).toEqual(['Peinture 100% acrylique']);
    });

    it('searches the name ignoring case, with % and _ taken literally', async () => {
      expect(names((await list({ q: 'BLANC' }).expect(200)).body)).toEqual([
        'Ciment blanc',
      ]);
      expect(names((await list({ q: '100%' }).expect(200)).body)).toEqual([
        'Peinture 100% acrylique',
      ]);
      expect((await list({ q: '%' }).expect(200)).body.total).toBe(1);
      expect((await list({ q: '_' }).expect(200)).body.total).toBe(0);
    });

    it('paginates', async () => {
      const response = await list({ page: '2', pageSize: '2' }).expect(200);

      expect(response.body).toMatchObject({ total: 3, page: 2, pageSize: 2 });
      expect(names(response.body)).toEqual(['Peinture 100% acrylique']);
    });

    it.each([
      ['a malformed category id', { categoryId: 'c-1' }, 'categoryId'],
      ['an unknown availability', { available: 'yes' }, 'available'],
    ])('refuses %s with a French 400', async (_, query, field) => {
      const response = await list(query).expect(400);

      expect(response.body.details).toContainEqual(
        expect.objectContaining({ field }),
      );
    });

    it('answers 404 to a member of another store', async () => {
      await list({}, outsider).expect(404);
    });
  });

  describe('GET and PATCH /stores/:storeId/articles/:articleId', () => {
    let articleId: string;

    beforeEach(async () => {
      articleId = (await create(cement()).expect(201)).body.id as string;
    });

    it('gives one article to managers and sellers', async () => {
      for (const as of [manager, seller]) {
        const response = await api()
          .get(`${articlesUrl()}/${articleId}`)
          .set('Authorization', as.authorization)
          .expect(200);

        expect(response.body).toMatchObject({
          id: articleId,
          currentPrice: '5000',
        });
      }
    });

    it('answers 404 for an article of another store, and 400 for a malformed id', async () => {
      const foreign = (
        await api()
          .post(articlesUrl(otherStoreId))
          .set('Authorization', outsider.authorization)
          .send(cement({ categoryId: foreignCategoryId }))
          .expect(201)
      ).body.id as string;

      await api()
        .get(`${articlesUrl()}/${foreign}`)
        .set('Authorization', seller.authorization)
        .expect(404)
        .expect((r) => expect(r.body.message).toBe('Article introuvable'));
      await update(foreign, { available: false }).expect(404);
      await update('a-1', { available: false })
        .expect(400)
        .expect((r) =>
          expect(r.body.message).toBe('Identifiant d’article invalide'),
        );
    });

    it('changes the fields sent and logs only what changed', async () => {
      const response = await update(articleId, {
        name: 'Ciment CPA 42.5',
        categoryId: paintId,
        unit: 'sac de 50 kg',
        available: false,
      }).expect(200);

      expect(response.body).toMatchObject({
        name: 'Ciment CPA 42.5',
        category: { id: paintId, name: 'Peinture' },
        unit: 'sac de 50 kg',
        currentPrice: '5000',
        available: false,
      });
      expect(
        await prisma.activityLog.findFirstOrThrow({
          where: { action: 'ARTICLE_UPDATED' },
        }),
      ).toMatchObject({
        oldValue: {
          articleId,
          name: 'Ciment CPA 45',
          categoryId: cementId,
          available: true,
        },
        newValue: {
          articleId,
          name: 'Ciment CPA 42.5',
          categoryId: paintId,
          available: false,
        },
      });
    });

    it('keeps what is omitted', async () => {
      const response = await update(articleId, { available: false }).expect(
        200,
      );

      expect(response.body).toMatchObject({
        name: 'Ciment CPA 45',
        category: { id: cementId },
        available: false,
      });
    });

    it('writes and logs nothing for a change to the same values (F-06)', async () => {
      const before = await prisma.article.findUniqueOrThrow({
        where: { id: articleId },
      });

      const response = await update(articleId, {
        name: 'Ciment CPA 45',
        categoryId: cementId,
        unit: 'sac de 50 kg',
        available: true,
      }).expect(200);

      expect(response.body).toMatchObject({
        id: articleId,
        name: 'Ciment CPA 45',
        available: true,
        updatedAt: before.updatedAt.toISOString(),
      });
      expect(
        await prisma.activityLog.count({
          where: { action: 'ARTICLE_UPDATED' },
        }),
      ).toBe(0);
    });

    it('treats the current category id in capitals as no change (F-07)', async () => {
      const before = await prisma.article.findUniqueOrThrow({
        where: { id: articleId },
      });

      const response = await update(articleId, {
        categoryId: cementId.toUpperCase(),
      }).expect(200);

      expect(response.body).toMatchObject({
        category: { id: cementId },
        updatedAt: before.updatedAt.toISOString(),
      });
      expect(
        await prisma.activityLog.count({
          where: { action: 'ARTICLE_UPDATED' },
        }),
      ).toBe(0);
    });

    it('logs the article id in lowercase when the URL has capitals (F-09)', async () => {
      await update(articleId.toUpperCase(), { available: false }).expect(200);
      await api()
        .post(`${articlesUrl()}/${articleId.toUpperCase()}/prices`)
        .set('Authorization', manager.authorization)
        .send({ price: '6000' })
        .expect(201);

      const rows = await prisma.activityLog.findMany({
        where: { action: { in: ['ARTICLE_UPDATED', 'ARTICLE_PRICE_CHANGED'] } },
      });
      expect(rows).toHaveLength(2);
      for (const row of rows) {
        expect(row.oldValue).toMatchObject({ articleId });
        expect(row.newValue).toMatchObject({ articleId });
      }
    });

    it('logs only the fields that really change', async () => {
      await update(articleId, {
        name: 'Ciment CPA 45',
        available: false,
      }).expect(200);

      const log = await prisma.activityLog.findFirstOrThrow({
        where: { action: 'ARTICLE_UPDATED' },
      });
      expect(log.oldValue).toEqual({ articleId, available: true });
      expect(log.newValue).toEqual({ articleId, available: false });
    });

    it('refuses an empty change, a null, and the price', async () => {
      await update(articleId, {})
        .expect(400)
        .expect((r) =>
          expect(r.body.message).toBe(
            'Indiquez au moins un champ à modifier : nom, catégorie, unité ou disponibilité',
          ),
        );
      await update(articleId, { name: null }).expect(400);
      // The price has its own route, to keep the history.
      await update(articleId, { price: '6000' }).expect(400);
    });

    it('refuses the name of another article with 409 ARTICLE_EXISTS', async () => {
      await create(cement({ name: 'Ciment blanc' })).expect(201);

      await update(articleId, { name: 'ciment BLANC' })
        .expect(409)
        .expect((r) => expect(r.body.error).toBe('ARTICLE_EXISTS'));
    });

    it('answers 404 for a category of another store', async () => {
      await update(articleId, { categoryId: foreignCategoryId })
        .expect(404)
        .expect((r) => expect(r.body.message).toBe('Catégorie introuvable'));
    });

    it('refuses a seller with 403 and a closed store with 409', async () => {
      await update(articleId, { available: false }, seller).expect(403);
      await prisma.hardwareStore.update({
        where: { id: storeId },
        data: { status: 'CLOSED' },
      });
      await update(articleId, { available: false })
        .expect(409)
        .expect((r) => expect(r.body.error).toBe('STORE_CLOSED'));
    });
  });
});
