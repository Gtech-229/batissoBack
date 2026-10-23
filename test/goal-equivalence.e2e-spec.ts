import type { INestApplication } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { createTestApp } from './utils/app.js';
import { createMali, createStoreRecord } from './utils/countries.js';
import { resetDatabase } from './utils/reset-database.js';
import { signedInStaff, type MobileStaff } from './utils/staff.js';

describe('Savings as material equivalence (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let storeId: string;
  let otherStoreId: string;
  let manager: MobileStaff;
  let seller: MobileStaff;
  let outsider: MobileStaff;
  let customer: MobileStaff;
  let other: MobileStaff;
  let accountId: string;
  let otherAccountId: string;
  let unassignedId: string;
  let cementCategoryId: string;
  let paintCategoryId: string;
  let cementId: string;
  let ironId: string;
  let paintId: string;
  let foreignArticleId: string;

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
    customer = await signedInStaff(app, prisma, { phone: '+22376445566' });
    other = await signedInStaff(app, prisma, { phone: '+22376112233' });
    accountId = await openAccount(customer.phone);
    otherAccountId = await openAccount(other.phone);
    unassignedId = (
      await prisma.goal.findFirstOrThrow({
        where: { accountId, isSystem: true },
      })
    ).id;
    cementCategoryId = await category(storeId, 'Ciment');
    paintCategoryId = await category(storeId, 'Peinture');
    cementId = await article(manager, storeId, {
      name: 'Ciment CPA 45',
      categoryId: cementCategoryId,
      unit: 'sac de 50 kg',
      price: '5000',
    });
    ironId = await article(manager, storeId, {
      name: 'Fer de 10',
      categoryId: cementCategoryId,
      unit: 'barre de 12 m',
      price: '4000',
    });
    paintId = await article(manager, storeId, {
      name: 'Peinture blanche',
      categoryId: paintCategoryId,
      unit: 'pot de 20 L',
      price: '25000',
      available: false,
    });
    foreignArticleId = await article(outsider, otherStoreId, {
      name: 'Ciment CPA 45',
      categoryId: await category(otherStoreId, 'Ciment'),
      unit: 'sac de 50 kg',
      price: '4500',
    });
  });

  afterAll(async () => {
    await app.close();
  });

  const api = () => request(app.getHttpServer());
  const openAccount = async (phone: string) =>
    (
      await api()
        .post(`/api/v1/stores/${storeId}/accounts`)
        .set('Authorization', seller.authorization)
        .send({
          customer: { phone, firstName: 'Fanta', lastName: 'Keita' },
          termsAccepted: true,
        })
        .expect(201)
    ).body.id as string;
  const category = async (store: string, name: string) =>
    (await prisma.articleCategory.create({ data: { storeId: store, name } }))
      .id;
  const article = async (
    as: MobileStaff,
    store: string,
    body: Record<string, unknown>,
  ) =>
    (
      await api()
        .post(`/api/v1/stores/${store}/articles`)
        .set('Authorization', as.authorization)
        .send(body)
        .expect(201)
    ).body.id as string;
  const goalsUrl = () => `/api/v1/me/accounts/${accountId}/goals`;
  const createGoal = (body: Record<string, unknown>) =>
    api()
      .post(goalsUrl())
      .set('Authorization', customer.authorization)
      .send({ label: 'Ciment', targetAmount: '150000', ...body });
  const patchGoal = (goalId: string, body: Record<string, unknown>) =>
    api()
      .patch(`${goalsUrl()}/${goalId}`)
      .set('Authorization', customer.authorization)
      .send(body);
  const deposit = (amount: string, goalId?: string) =>
    api()
      .post(`/api/v1/stores/${storeId}/accounts/${accountId}/deposits`)
      .set('Authorization', seller.authorization)
      .set('Idempotency-Key', randomUUID())
      .send({ amount, goalId })
      .expect(201);
  const changePrice = (articleId: string, price: string) =>
    api()
      .post(`/api/v1/stores/${storeId}/articles/${articleId}/prices`)
      .set('Authorization', manager.authorization)
      .send({ price })
      .expect(201);
  const myGoal = async (goalId: string) => {
    const response = await api()
      .get('/api/v1/me/accounts')
      .set('Authorization', customer.authorization)
      .expect(200);
    const account = (
      response.body as { id: string; goals: { id: string }[] }[]
    ).find((a) => a.id === accountId);
    return account?.goals.find((goal) => goal.id === goalId);
  };
  const myArticles = (query: Record<string, string> = {}, as = customer) =>
    api()
      .get(`/api/v1/me/accounts/${accountId}/articles`)
      .query(query)
      .set('Authorization', as.authorization);
  const quantities = (body: { items: { name: string; quantity: string }[] }) =>
    body.items.map((item) => [item.name, item.quantity]);

  describe('a goal linked to an article', () => {
    it('shows the balance and the target as whole units at the price of the day', async () => {
      const goal = await createGoal({ articleId: cementId }).expect(201);

      expect(goal.body.equivalence).toEqual({
        article: {
          id: cementId,
          name: 'Ciment CPA 45',
          unit: 'sac de 50 kg',
          unitPrice: '5000',
          available: true,
        },
        quantity: '0',
        targetQuantity: '30',
      });

      await deposit('34999', goal.body.id);

      expect(await myGoal(goal.body.id)).toMatchObject({
        balance: '34999',
        equivalence: { quantity: '6', targetQuantity: '30' },
      });
      // Staff see the same in the account detail.
      const detail = await api()
        .get(`/api/v1/stores/${storeId}/accounts/${accountId}`)
        .set('Authorization', seller.authorization)
        .expect(200);
      expect(
        (detail.body.goals as { id: string }[]).find(
          (g) => g.id === goal.body.id,
        ),
      ).toMatchObject({ equivalence: { quantity: '6' } });
    });

    it('follows the price of the day', async () => {
      const goalId = (await createGoal({ articleId: cementId }).expect(201))
        .body.id as string;
      await deposit('30000', goalId);

      await changePrice(cementId, '6000');

      expect(await myGoal(goalId)).toMatchObject({
        equivalence: {
          article: { unitPrice: '6000' },
          quantity: '5',
          targetQuantity: '25',
        },
      });
    });

    it('links, unlinks, and relinks an existing goal', async () => {
      const goalId = (await createGoal({}).expect(201)).body.id as string;

      const linked = await patchGoal(goalId, { articleId: cementId }).expect(
        200,
      );
      expect(linked.body.equivalence.article.id).toBe(cementId);

      const unlinked = await patchGoal(goalId, { articleId: null }).expect(200);
      expect(unlinked.body.equivalence).toBeNull();

      const relinked = await patchGoal(goalId, { articleId: ironId }).expect(
        200,
      );
      expect(relinked.body.equivalence).toMatchObject({
        article: { id: ironId, unit: 'barre de 12 m' },
        targetQuantity: '37',
      });
    });

    it('keeps the link when only the label changes', async () => {
      const goalId = (await createGoal({ articleId: cementId }).expect(201))
        .body.id as string;

      const renamed = await patchGoal(goalId, { label: 'Ciment CPA' }).expect(
        200,
      );

      expect(renamed.body.equivalence.article.id).toBe(cementId);
    });

    it('refuses an article no longer on sale with 409 ARTICLE_UNAVAILABLE', async () => {
      const response = await createGoal({ articleId: paintId }).expect(409);
      expect(response.body).toMatchObject({
        error: 'ARTICLE_UNAVAILABLE',
        message: 'Cet article n’est plus en vente',
      });

      const goalId = (await createGoal({}).expect(201)).body.id as string;
      await patchGoal(goalId, { articleId: paintId })
        .expect(409)
        .expect((r) => expect(r.body.error).toBe('ARTICLE_UNAVAILABLE'));
    });

    it('keeps an existing link when the article goes off sale', async () => {
      const goalId = (await createGoal({ articleId: cementId }).expect(201))
        .body.id as string;

      await api()
        .patch(`/api/v1/stores/${storeId}/articles/${cementId}`)
        .set('Authorization', manager.authorization)
        .send({ available: false })
        .expect(200);

      expect(await myGoal(goalId)).toMatchObject({
        equivalence: { article: { id: cementId, available: false } },
      });
    });

    it('answers 404 for an article of another store', async () => {
      await createGoal({ articleId: foreignArticleId })
        .expect(404)
        .expect((r) => expect(r.body.message).toBe('Article introuvable'));

      const goalId = (await createGoal({}).expect(201)).body.id as string;
      await patchGoal(goalId, { articleId: foreignArticleId }).expect(404);
    });

    it('refuses the Unassigned goal and a closed goal', async () => {
      await patchGoal(unassignedId, { articleId: cementId })
        .expect(409)
        .expect((r) => expect(r.body.error).toBe('SYSTEM_GOAL'));

      const goalId = (await createGoal({}).expect(201)).body.id as string;
      await api()
        .post(`/api/v1/me/accounts/${accountId}/goals/${goalId}/close`)
        .set('Authorization', customer.authorization)
        .expect(200);
      await patchGoal(goalId, { articleId: cementId })
        .expect(409)
        .expect((r) => expect(r.body.error).toBe('GOAL_CLOSED'));
    });

    it('refuses a malformed article id with a French 400', async () => {
      const response = await createGoal({ articleId: 'a-1' }).expect(400);

      expect(response.body.details).toContainEqual({
        field: 'articleId',
        errors: ['Identifiant d’article invalide'],
      });
    });
  });

  describe('GET /me/accounts/:accountId/articles', () => {
    beforeEach(async () => {
      await deposit('50000');
    });

    it('lists the articles on sale with the units the account balance buys', async () => {
      const response = await myArticles().expect(200);

      expect(response.body).toMatchObject({ total: 2, page: 1, pageSize: 20 });
      expect(response.body.items[0]).toEqual({
        id: cementId,
        name: 'Ciment CPA 45',
        category: { id: cementCategoryId, name: 'Ciment' },
        unit: 'sac de 50 kg',
        unitPrice: '5000',
        currencyCode: 'XOF',
        quantity: '10',
      });
      // The unavailable paint and the other store's article are not listed.
      expect(quantities(response.body)).toEqual([
        ['Ciment CPA 45', '10'],
        ['Fer de 10', '12'],
      ]);
    });

    it('uses one goal’s balance with goalId', async () => {
      const goalId = (await createGoal({}).expect(201)).body.id as string;
      await api()
        .post(`/api/v1/me/accounts/${accountId}/goal-movements`)
        .set('Authorization', customer.authorization)
        .set('Idempotency-Key', randomUUID())
        .send({
          sourceGoalId: unassignedId,
          targetGoalId: goalId,
          amount: '9000',
        })
        .expect(201);

      const response = await myArticles({ goalId }).expect(200);

      expect(quantities(response.body)).toEqual([
        ['Ciment CPA 45', '1'],
        ['Fer de 10', '2'],
      ]);
    });

    it('filters by category and searches the name', async () => {
      expect(
        quantities(
          (await myArticles({ categoryId: paintCategoryId }).expect(200)).body,
        ),
      ).toEqual([]);
      expect(
        quantities((await myArticles({ q: 'FER' }).expect(200)).body),
      ).toEqual([['Fer de 10', '12']]);
    });

    it('answers 404 for a goal of another account', async () => {
      const foreignGoal = (
        await prisma.goal.findFirstOrThrow({
          where: { accountId: otherAccountId },
        })
      ).id;

      await myArticles({ goalId: foreignGoal })
        .expect(404)
        .expect((r) => expect(r.body.message).toBe('Objectif introuvable'));
    });

    it('answers 404 to another customer and to staff', async () => {
      for (const as of [other, seller]) {
        await myArticles({}, as)
          .expect(404)
          .expect((r) => expect(r.body.message).toBe('Compte introuvable'));
      }
    });

    it('refuses a malformed goal id with a French 400', async () => {
      const response = await myArticles({ goalId: 'g-1' }).expect(400);

      expect(response.body.details).toContainEqual(
        expect.objectContaining({ field: 'goalId' }),
      );
    });
  });
});
