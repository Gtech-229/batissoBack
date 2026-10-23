import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { createTestApp } from './utils/app.js';
import { createMali, createStoreRecord } from './utils/countries.js';
import { resetDatabase } from './utils/reset-database.js';
import { signedInStaff, type MobileStaff } from './utils/staff.js';

describe('Article categories (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let storeId: string;
  let otherStoreId: string;
  let manager: MobileStaff;
  let seller: MobileStaff;
  let outsider: MobileStaff;

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
  });

  afterAll(async () => {
    await app.close();
  });

  const api = () => request(app.getHttpServer());
  const categoriesUrl = (store = storeId) =>
    `/api/v1/stores/${store}/article-categories`;
  const create = (name: unknown, as: MobileStaff = manager, store = storeId) =>
    api()
      .post(categoriesUrl(store))
      .set('Authorization', as.authorization)
      .send({ name });
  const rename = (categoryId: string, name: unknown, as = manager) =>
    api()
      .patch(`${categoriesUrl()}/${categoryId}`)
      .set('Authorization', as.authorization)
      .send({ name });
  const list = (as: MobileStaff) =>
    api().get(categoriesUrl()).set('Authorization', as.authorization);

  describe('GET /stores/:storeId/article-categories', () => {
    it('lists the store’s categories by name, to managers and sellers', async () => {
      await create('Peinture').expect(201);
      await create('Bois').expect(201);
      await create('Ciment').expect(201);
      await create('Fer', outsider, otherStoreId).expect(201);

      for (const as of [manager, seller]) {
        const response = await list(as).expect(200);
        expect(
          (response.body as { name: string }[]).map((c) => c.name),
        ).toEqual(['Bois', 'Ciment', 'Peinture']);
      }
    });

    it('sorts alphabetically for people: case and accents do not come first', async () => {
      for (const name of [
        'Quincaillerie',
        'Électricité',
        'bois',
        'Carrelage',
      ]) {
        await create(name).expect(201);
      }

      const response = await list(seller).expect(200);

      expect((response.body as { name: string }[]).map((c) => c.name)).toEqual([
        'bois',
        'Carrelage',
        'Électricité',
        'Quincaillerie',
      ]);
    });

    it('answers 404 to a member of another store', async () => {
      await list(outsider)
        .expect(404)
        .expect((r) =>
          expect(r.body.message).toBe('Quincaillerie introuvable'),
        );
    });
  });

  describe('POST /stores/:storeId/article-categories', () => {
    it('creates a trimmed category and logs it', async () => {
      const response = await create('  Ciment  ').expect(201);

      expect(response.body).toEqual({
        id: expect.any(String),
        name: 'Ciment',
        createdAt: expect.any(String),
      });
      expect(
        await prisma.activityLog.findFirstOrThrow({
          where: { action: 'ARTICLE_CATEGORY_CREATED' },
        }),
      ).toMatchObject({
        storeId,
        userId: manager.userId,
        device: manager.deviceId,
        newValue: { categoryId: response.body.id, name: 'Ciment' },
      });
    });

    it('refuses a name the store already uses, in another case, with 409 CATEGORY_EXISTS', async () => {
      await create('Ciment').expect(201);

      const response = await create('CIMENT').expect(409);

      expect(response.body).toMatchObject({
        error: 'CATEGORY_EXISTS',
        message: 'Cette quincaillerie a déjà une catégorie de ce nom',
      });
      expect(await prisma.articleCategory.count({ where: { storeId } })).toBe(
        1,
      );
    });

    it('creates one category when the same name is sent twice in parallel', async () => {
      const responses = await Promise.all([create('Ciment'), create('ciment')]);

      expect(responses.map((r) => r.status).sort((a, b) => a - b)).toEqual([
        201, 409,
      ]);
    });

    it('allows a name another store already uses', async () => {
      await create('Ciment', outsider, otherStoreId).expect(201);

      await create('Ciment').expect(201);
    });

    it.each([
      ['an empty name', '   '],
      ['a name over 60 characters', 'x'.repeat(61)],
      ['a missing name', undefined],
    ])('refuses %s with a French 400', async (_, name) => {
      const response = await create(name).expect(400);

      expect(response.body.details).toContainEqual(
        expect.objectContaining({
          field: 'name',
          errors: ['Le nom de la catégorie doit contenir 1 à 60 caractères'],
        }),
      );
    });

    it('refuses a seller with 403 STORE_ROLE_REQUIRED', async () => {
      await create('Ciment', seller)
        .expect(403)
        .expect((r) => expect(r.body.error).toBe('STORE_ROLE_REQUIRED'));
    });

    it('refuses a closed store with 409 STORE_CLOSED', async () => {
      await prisma.hardwareStore.update({
        where: { id: storeId },
        data: { status: 'CLOSED' },
      });

      await create('Ciment')
        .expect(409)
        .expect((r) => expect(r.body.error).toBe('STORE_CLOSED'));
      // Reading stays allowed.
      await list(manager).expect(200);
    });

    it.each(['PENDING', 'SUSPENDED'] as const)(
      'allows changes in a %s store',
      async (status) => {
        await prisma.hardwareStore.update({
          where: { id: storeId },
          data: { status },
        });

        await create('Ciment').expect(201);
      },
    );
  });

  describe('PATCH /stores/:storeId/article-categories/:categoryId', () => {
    let categoryId: string;

    beforeEach(async () => {
      categoryId = (await create('Ciment').expect(201)).body.id as string;
    });

    it('renames a category and logs the old and new names', async () => {
      const response = await rename(categoryId, 'Ciments et liants').expect(
        200,
      );

      expect(response.body).toMatchObject({
        id: categoryId,
        name: 'Ciments et liants',
      });
      expect(
        await prisma.activityLog.findFirstOrThrow({
          where: { action: 'ARTICLE_CATEGORY_RENAMED' },
        }),
      ).toMatchObject({
        oldValue: { categoryId, name: 'Ciment' },
        newValue: { categoryId, name: 'Ciments et liants' },
      });
    });

    it('logs what each of parallel renames really replaced (F-08)', async () => {
      // Five rounds of four simultaneous renames: enough overlap that, without
      // the row lock, two renames read the same old name.
      for (let round = 0; round < 5; round++) {
        const responses = await Promise.all(
          [1, 2, 3, 4].map((n) => rename(categoryId, `Liants ${round}-${n}`)),
        );
        expect(responses.map((r) => r.status)).toEqual([200, 200, 200, 200]);
      }

      const logs = await prisma.activityLog.findMany({
        where: { action: 'ARTICLE_CATEGORY_RENAMED' },
      });
      const name = (value: unknown) => (value as { name: string }).name;
      const olds = logs.map((log) => name(log.oldValue));
      const news = logs.map((log) => name(log.newValue));
      expect(logs).toHaveLength(20);
      // The renames ran one after the other, so the names form one chain:
      // every old name was replaced exactly once, and each old name is
      // "Ciment" or a name an earlier rename wrote. (The rows' createdAt is the
      // transaction start, so the chain, not the dates, gives the order.)
      expect(new Set(olds).size).toBe(20);
      for (const old of olds) {
        expect(old === 'Ciment' || news.includes(old)).toBe(true);
      }
      const category = await prisma.articleCategory.findUniqueOrThrow({
        where: { id: categoryId },
      });
      // The final name is the one no rename replaced.
      expect(news.filter((n) => !olds.includes(n))).toEqual([category.name]);
    });

    it('logs the id in lowercase when the URL has capitals', async () => {
      await rename(categoryId.toUpperCase(), 'Liants').expect(200);

      expect(
        await prisma.activityLog.findFirstOrThrow({
          where: { action: 'ARTICLE_CATEGORY_RENAMED' },
        }),
      ).toMatchObject({
        oldValue: { categoryId, name: 'Ciment' },
        newValue: { categoryId, name: 'Liants' },
      });
    });

    it('lets a category change the case of its own name, and logs it', async () => {
      await rename(categoryId, 'CIMENT').expect(200);

      expect(
        await prisma.activityLog.count({
          where: { action: 'ARTICLE_CATEGORY_RENAMED' },
        }),
      ).toBe(1);
    });

    it('writes and logs nothing for a rename to the same name (F-06)', async () => {
      const response = await rename(categoryId, '  Ciment ').expect(200);

      expect(response.body).toMatchObject({ id: categoryId, name: 'Ciment' });
      expect(
        await prisma.activityLog.count({
          where: { action: 'ARTICLE_CATEGORY_RENAMED' },
        }),
      ).toBe(0);
    });

    it('refuses the name of another category with 409 CATEGORY_EXISTS', async () => {
      await create('Bois').expect(201);

      await rename(categoryId, 'bois')
        .expect(409)
        .expect((r) => expect(r.body.error).toBe('CATEGORY_EXISTS'));
    });

    it('answers 404 for a category of another store', async () => {
      const foreign = (await create('Fer', outsider, otherStoreId).expect(201))
        .body.id as string;

      await rename(foreign, 'Acier')
        .expect(404)
        .expect((r) => expect(r.body.message).toBe('Catégorie introuvable'));
    });

    it('refuses a malformed id with a French 400', async () => {
      await rename('c-1', 'Acier')
        .expect(400)
        .expect((r) =>
          expect(r.body.message).toBe('Identifiant de catégorie invalide'),
        );
    });

    it('refuses a seller with 403', async () => {
      await rename(categoryId, 'Acier', seller).expect(403);
    });

    it('refuses a closed store with 409 STORE_CLOSED', async () => {
      await prisma.hardwareStore.update({
        where: { id: storeId },
        data: { status: 'CLOSED' },
      });

      await rename(categoryId, 'Acier').expect(409);
    });
  });

  describe('GET /me/accounts/:accountId/article-categories', () => {
    let customer: MobileStaff;
    let accountId: string;

    beforeEach(async () => {
      customer = await signedInStaff(app, prisma, { phone: '+22376445566' });
      accountId = (
        await api()
          .post(`/api/v1/stores/${storeId}/accounts`)
          .set('Authorization', seller.authorization)
          .send({
            customer: {
              phone: customer.phone,
              firstName: 'Fanta',
              lastName: 'Keita',
            },
            termsAccepted: true,
          })
          .expect(201)
      ).body.id as string;
      await create('Ciment').expect(201);
      await create('Fer', outsider, otherStoreId).expect(201);
    });

    it('lists the categories of the account’s store', async () => {
      const response = await api()
        .get(`/api/v1/me/accounts/${accountId}/article-categories`)
        .set('Authorization', customer.authorization)
        .expect(200);

      expect(response.body).toEqual([
        {
          id: expect.any(String),
          name: 'Ciment',
          createdAt: expect.any(String),
        },
      ]);
    });

    it('answers 404 to another user, staff included', async () => {
      for (const as of [seller, outsider]) {
        await api()
          .get(`/api/v1/me/accounts/${accountId}/article-categories`)
          .set('Authorization', as.authorization)
          .expect(404)
          .expect((r) => expect(r.body.message).toBe('Compte introuvable'));
      }
    });
  });
});
