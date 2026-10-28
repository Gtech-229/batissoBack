import type { INestApplication } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { createTestApp } from './utils/app.js';
import { createMali, createStoreRecord } from './utils/countries.js';
import { resetDatabase } from './utils/reset-database.js';
import { signedInStaff, type MobileStaff } from './utils/staff.js';

// The test stores' validation threshold (test/utils/countries.ts).
const THRESHOLD = 200000;

describe('Preparing material orders (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let storeId: string;
  let otherStoreId: string;
  let manager: MobileStaff;
  let seller: MobileStaff;
  let outsider: MobileStaff;
  let customer: MobileStaff;
  let accountId: string;
  let unassignedId: string;
  let cementGoalId: string;
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
      firstName: 'Awa',
      store: { id: storeId, role: 'MANAGER' },
    });
    seller = await signedInStaff(app, prisma, {
      phone: '+22376000001',
      firstName: 'Moussa',
      store: { id: storeId, role: 'SELLER' },
    });
    outsider = await signedInStaff(app, prisma, {
      phone: '+22376000002',
      store: { id: otherStoreId, role: 'MANAGER' },
    });
    customer = await signedInStaff(app, prisma, { phone: '+22376445566' });
    accountId = await openAccount(customer.phone);
    unassignedId = (
      await prisma.goal.findFirstOrThrow({
        where: { accountId, isSystem: true },
      })
    ).id;
    cementGoalId = (
      await api()
        .post(`/api/v1/me/accounts/${accountId}/goals`)
        .set('Authorization', customer.authorization)
        .send({ label: 'Ciment', targetAmount: '500000' })
        .expect(201)
    ).body.id as string;
    // 300 000 in Unassigned and 50 000 in the Ciment goal.
    await deposit('300000');
    await deposit('50000', cementGoalId);
    const categoryId = await category(storeId);
    cementId = await article(storeId, categoryId, 'Ciment CPA 45', 5000n);
    ironId = await article(storeId, categoryId, 'Fer de 10', 4000n);
    paintId = await article(storeId, categoryId, 'Peinture', 25000n, false);
    foreignArticleId = await article(
      otherStoreId,
      await category(otherStoreId),
      'Ciment CPA 45',
      4500n,
    );
  });

  afterAll(async () => {
    await app.close();
  });

  const api = () => request(app.getHttpServer());
  const openAccount = async (phone: string, as = seller, store = storeId) =>
    (
      await api()
        .post(`/api/v1/stores/${store}/accounts`)
        .set('Authorization', as.authorization)
        .send({
          customer: { phone, firstName: 'Fanta', lastName: 'Keita' },
          termsAccepted: true,
        })
        .expect(201)
    ).body.id as string;
  const deposit = (amount: string, goalId?: string) =>
    api()
      .post(`/api/v1/stores/${storeId}/accounts/${accountId}/deposits`)
      .set('Authorization', seller.authorization)
      .set('Idempotency-Key', randomUUID())
      .send({ amount, goalId })
      .expect(201);
  const category = async (store: string) =>
    (
      await prisma.articleCategory.create({
        data: { storeId: store, name: 'Ciment' },
      })
    ).id;
  const article = async (
    store: string,
    categoryId: string,
    name: string,
    price: bigint,
    available = true,
  ) =>
    (
      await prisma.article.create({
        data: {
          storeId: store,
          categoryId,
          name,
          unit: 'sac de 50 kg',
          currentPrice: price,
          available,
        },
      })
    ).id;
  const prepare = (
    body: Record<string, unknown>,
    options: { as?: MobileStaff; account?: string; store?: string } = {},
  ) =>
    api()
      .post(
        `/api/v1/stores/${options.store ?? storeId}/accounts/${options.account ?? accountId}/orders`,
      )
      .set('Authorization', (options.as ?? seller).authorization)
      .send(body);
  const cement = (quantity: number) => ({
    lines: [{ articleId: cementId, quantity }],
  });
  const orderCount = () => prisma.materialOrder.count();

  describe('POST /stores/:storeId/accounts/:accountId/orders', () => {
    it('prepares a seller’s order under the threshold for the customer, with frozen lines', async () => {
      const response = await prepare({
        lines: [
          { articleId: cementId, quantity: 10 },
          { articleId: ironId, quantity: 5 },
        ],
      }).expect(201);

      expect(response.body).toEqual({
        id: expect.any(String),
        reference: expect.stringMatching(/^B-\d{5,}$/),
        status: 'AWAITING_CUSTOMER',
        accountId,
        accountNumber: expect.stringMatching(/^C-\d+$/),
        goal: { id: unassignedId, label: 'Non affecté' },
        total: '70000',
        currencyCode: 'XOF',
        lines: [
          {
            articleId: cementId,
            articleName: 'Ciment CPA 45',
            unit: 'sac de 50 kg',
            quantity: 10,
            unitPrice: '5000',
            lineTotal: '50000',
          },
          {
            articleId: ironId,
            articleName: 'Fer de 10',
            unit: 'sac de 50 kg',
            quantity: 5,
            unitPrice: '4000',
            lineTotal: '20000',
          },
        ],
        createdBy: {
          userId: seller.userId,
          firstName: 'Moussa',
          lastName: expect.any(String),
        },
        validatedBy: null,
        validatedAt: null,
        refusedBy: null,
        refusalReason: null,
        refusedAt: null,
        cancelledBy: null,
        cancellationReason: null,
        cancelledAt: null,
        confirmedAt: null,
        confirmedVia: null,
        debitReference: null,
        customerRefusedAt: null,
        customerRefusalReason: null,
        deliveredBy: null,
        deliveredAt: null,
        recreditReference: null,
        createdAt: expect.any(String),
      });
      // No money moves before the customer confirms (10b).
      expect(await prisma.operation.count()).toBe(2);
    });

    it('sends a seller’s order above the threshold to the manager', async () => {
      const response = await prepare(cement(THRESHOLD / 5000 + 1)).expect(201);

      expect(response.body).toMatchObject({
        status: 'AWAITING_VALIDATION',
        total: '205000',
        validatedBy: null,
      });
    });

    it('does not make an order equal to the threshold wait', async () => {
      const response = await prepare(cement(THRESHOLD / 5000)).expect(201);

      expect(response.body).toMatchObject({
        status: 'AWAITING_CUSTOMER',
        total: '200000',
      });
    });

    it('counts the manager’s own order above the threshold as validated', async () => {
      const response = await prepare(cement(50), { as: manager }).expect(201);

      expect(response.body).toMatchObject({
        status: 'AWAITING_CUSTOMER',
        total: '250000',
        createdBy: { userId: manager.userId },
        validatedBy: { userId: manager.userId },
        validatedAt: expect.any(String),
      });
    });

    it('keeps the frozen price when the article’s price changes afterwards', async () => {
      const order = await prepare(cement(10)).expect(201);
      await api()
        .post(`/api/v1/stores/${storeId}/articles/${cementId}/prices`)
        .set('Authorization', manager.authorization)
        .send({ price: '6000' })
        .expect(201);
      await api()
        .patch(`/api/v1/stores/${storeId}/articles/${cementId}`)
        .set('Authorization', manager.authorization)
        .send({ name: 'Ciment CPA 42.5' })
        .expect(200);

      const detail = await api()
        .get(`/api/v1/stores/${storeId}/orders/${order.body.id}`)
        .set('Authorization', seller.authorization)
        .expect(200);

      expect(detail.body).toMatchObject({
        total: '50000',
        lines: [
          {
            articleName: 'Ciment CPA 45',
            unitPrice: '5000',
            lineTotal: '50000',
          },
        ],
      });
    });

    it('pays from the chosen goal plus Unassigned, and refuses more with 409 INSUFFICIENT_BALANCE', async () => {
      // Ciment goal 50 000 + Unassigned 300 000 = 350 000.
      await prepare({ goalId: cementGoalId, ...cement(70) })
        .expect(201)
        .expect((r) =>
          expect(r.body.goal).toEqual({ id: cementGoalId, label: 'Ciment' }),
        );

      const response = await prepare({
        goalId: cementGoalId,
        ...cement(71),
      }).expect(409);

      expect(response.body).toMatchObject({
        error: 'INSUFFICIENT_BALANCE',
        message:
          'Ce bon de 355000 XOF dépasse ce qui est disponible : 350000 XOF (objectif choisi et « Non affecté »)',
      });
    });

    it('counts only Unassigned when it is the goal paid', async () => {
      // 61 bags: 305 000 > the 300 000 in Unassigned.
      await prepare(cement(61))
        .expect(409)
        .expect((r) => expect(r.body.error).toBe('INSUFFICIENT_BALANCE'));
      await prepare({ goalId: unassignedId, ...cement(61) }).expect(409);
      expect(await orderCount()).toBe(0);
    });

    it.each([
      ['no line', { lines: [] }, 'lines'],
      [
        'more than 50 lines',
        {
          lines: Array.from({ length: 51 }, () => ({
            articleId: randomUUID(),
            quantity: 1,
          })),
        },
        'lines',
      ],
      ['a missing lines field', {}, 'lines'],
      [
        'a quantity of 0',
        { lines: [{ articleId: randomUUID(), quantity: 0 }] },
        'lines.0.quantity',
      ],
      [
        'a decimal quantity',
        { lines: [{ articleId: randomUUID(), quantity: 1.5 }] },
        'lines.0.quantity',
      ],
      [
        'a quantity over 1 000 000',
        { lines: [{ articleId: randomUUID(), quantity: 1000001 }] },
        'lines.0.quantity',
      ],
      [
        'a malformed article id',
        { lines: [{ articleId: 'a-1', quantity: 1 }] },
        'lines.0.articleId',
      ],
      [
        'a null goal id',
        { goalId: null, lines: [{ articleId: randomUUID(), quantity: 1 }] },
        'goalId',
      ],
    ])('refuses %s with a French 400', async (_, body, field) => {
      const response = await prepare(body).expect(400);

      expect(response.body.details).toContainEqual(
        expect.objectContaining({ field }),
      );
      expect(await orderCount()).toBe(0);
    });

    it('refuses the same article twice, naming the repeated line', async () => {
      const response = await prepare({
        lines: [
          { articleId: cementId, quantity: 1 },
          { articleId: ironId, quantity: 1 },
          { articleId: cementId.toUpperCase(), quantity: 2 },
        ],
      }).expect(400);

      expect(response.body.details).toEqual([
        {
          field: 'lines.2.articleId',
          errors: ['Cet article figure déjà sur une autre ligne du bon'],
        },
      ]);
    });

    it('answers 404 for another store’s article and another account’s goal', async () => {
      await prepare({ lines: [{ articleId: foreignArticleId, quantity: 1 }] })
        .expect(404)
        .expect((r) => expect(r.body.message).toBe('Article introuvable'));

      const otherAccountId = await openAccount('+22376112233');
      const foreignGoal = (
        await prisma.goal.findFirstOrThrow({
          where: { accountId: otherAccountId },
        })
      ).id;
      await prepare({ goalId: foreignGoal, ...cement(1) })
        .expect(404)
        .expect((r) => expect(r.body.message).toBe('Objectif introuvable'));
      expect(await orderCount()).toBe(0);
    });

    it('refuses an article off sale and a closed goal with 409', async () => {
      await prepare({ lines: [{ articleId: paintId, quantity: 1 }] })
        .expect(409)
        .expect((r) => expect(r.body.error).toBe('ARTICLE_UNAVAILABLE'));

      const closable = (
        await api()
          .post(`/api/v1/me/accounts/${accountId}/goals`)
          .set('Authorization', customer.authorization)
          .send({ label: 'Fer', targetAmount: '10000' })
          .expect(201)
      ).body.id as string;
      await api()
        .post(`/api/v1/me/accounts/${accountId}/goals/${closable}/close`)
        .set('Authorization', customer.authorization)
        .expect(200);
      await prepare({ goalId: closable, ...cement(1) })
        .expect(409)
        .expect((r) => expect(r.body.error).toBe('GOAL_CLOSED'));
    });

    it('refuses a closed store with 409 STORE_CLOSED, and serves a suspended one', async () => {
      await prisma.hardwareStore.update({
        where: { id: storeId },
        data: { status: 'SUSPENDED' },
      });
      await prepare(cement(1)).expect(201);

      await prisma.hardwareStore.update({
        where: { id: storeId },
        data: { status: 'CLOSED' },
      });
      await prepare(cement(1))
        .expect(409)
        .expect((r) => expect(r.body.error).toBe('STORE_CLOSED'));
    });

    it('refuses an order on the preparer’s own account with 409 OWN_ACCOUNT', async () => {
      const ownAccountId = await openAccount(seller.phone, manager);

      await prepare(cement(1), { account: ownAccountId })
        .expect(409)
        .expect((r) => expect(r.body.error).toBe('OWN_ACCOUNT'));
    });

    it('answers 404 to a member of another store and for another store’s account', async () => {
      await prepare(cement(1), { as: outsider })
        .expect(404)
        .expect((r) =>
          expect(r.body.message).toBe('Quincaillerie introuvable'),
        );

      const foreignAccount = await openAccount(
        '+22376998877',
        outsider,
        otherStoreId,
      );
      await prepare(cement(1), { account: foreignAccount })
        .expect(404)
        .expect((r) => expect(r.body.message).toBe('Compte introuvable'));
    });

    it('takes a new reference for each order', async () => {
      const first = await prepare(cement(1)).expect(201);
      const second = await prepare(cement(1)).expect(201);

      expect(second.body.reference).not.toBe(first.body.reference);
    });
  });

  describe('GET /stores/:storeId/orders/:orderId', () => {
    it('gives the order to the seller and the manager', async () => {
      const order = await prepare(cement(2)).expect(201);

      for (const as of [seller, manager]) {
        const response = await api()
          .get(`/api/v1/stores/${storeId}/orders/${order.body.id}`)
          .set('Authorization', as.authorization)
          .expect(200);
        expect(response.body).toEqual(order.body);
      }
    });

    it('answers 404 for another store’s order and 400 for a malformed id', async () => {
      const order = await prepare(cement(2)).expect(201);

      await api()
        .get(`/api/v1/stores/${otherStoreId}/orders/${order.body.id}`)
        .set('Authorization', outsider.authorization)
        .expect(404)
        .expect((r) => expect(r.body.message).toBe('Bon introuvable'));
      await api()
        .get(`/api/v1/stores/${storeId}/orders/b-1`)
        .set('Authorization', seller.authorization)
        .expect(400)
        .expect((r) =>
          expect(r.body.message).toBe('Identifiant de bon invalide'),
        );
    });
  });
});
