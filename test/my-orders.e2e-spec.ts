import type { INestApplication } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { createTestApp } from './utils/app.js';
import { createMali, createStoreRecord } from './utils/countries.js';
import { resetDatabase } from './utils/reset-database.js';
import { signedInStaff, type MobileStaff } from './utils/staff.js';

describe('Order lists and the customer’s orders (e2e)', () => {
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
  let cementId: string;

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
    await deposit(accountId);
    await deposit(otherAccountId);
    const categoryId = (
      await prisma.articleCategory.create({ data: { storeId, name: 'Ciment' } })
    ).id;
    cementId = (
      await prisma.article.create({
        data: {
          storeId,
          categoryId,
          name: 'Ciment CPA 45',
          unit: 'sac de 50 kg',
          currentPrice: 5000n,
        },
      })
    ).id;
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
          customer: { phone, firstName: 'F', lastName: 'K' },
          termsAccepted: true,
        })
        .expect(201)
    ).body.id as string;
  const deposit = (account: string) =>
    api()
      .post(`/api/v1/stores/${storeId}/accounts/${account}/deposits`)
      .set('Authorization', seller.authorization)
      .set('Idempotency-Key', randomUUID())
      .send({ amount: '500000' })
      .expect(201);
  /** 50 bags = 250 000 (waits for validation); 10 bags = 50 000. */
  const prepare = async (bags: number, account = accountId) =>
    (
      await api()
        .post(`/api/v1/stores/${storeId}/accounts/${account}/orders`)
        .set('Authorization', seller.authorization)
        .send({ lines: [{ articleId: cementId, quantity: bags }] })
        .expect(201)
    ).body as { id: string; reference: string };
  const staffList = (query: Record<string, string> = {}, as = seller) =>
    api()
      .get(`/api/v1/stores/${storeId}/orders`)
      .query(query)
      .set('Authorization', as.authorization);
  const myList = (
    query: Record<string, string> = {},
    as = customer,
    account = accountId,
  ) =>
    api()
      .get(`/api/v1/me/accounts/${account}/orders`)
      .query(query)
      .set('Authorization', as.authorization);
  const references = (body: { items: { reference: string }[] }) =>
    body.items.map((item) => item.reference);

  describe('GET /stores/:storeId/orders', () => {
    it('lists the store’s orders newest first, to sellers and the manager', async () => {
      const first = await prepare(10);
      const second = await prepare(50);
      const third = await prepare(5, otherAccountId);

      for (const as of [seller, manager]) {
        const response = await staffList({}, as).expect(200);
        expect(response.body).toMatchObject({
          total: 3,
          page: 1,
          pageSize: 20,
        });
        expect(references(response.body)).toEqual([
          third.reference,
          second.reference,
          first.reference,
        ]);
        expect(response.body.items[0]).toMatchObject({
          createdBy: { userId: seller.userId },
          lines: [expect.objectContaining({ quantity: 5 })],
        });
      }
    });

    it('filters by status and by account, and paginates', async () => {
      const small = await prepare(10);
      const large = await prepare(50);
      const elsewhere = await prepare(5, otherAccountId);

      expect(
        references(
          (await staffList({ status: 'AWAITING_VALIDATION' }).expect(200)).body,
        ),
      ).toEqual([large.reference]);
      expect(
        references(
          (
            await staffList({ accountId: otherAccountId.toUpperCase() }).expect(
              200,
            )
          ).body,
        ),
      ).toEqual([elsewhere.reference]);
      const page = await staffList({ page: '2', pageSize: '2' }).expect(200);
      expect(page.body).toMatchObject({ total: 3, page: 2, pageSize: 2 });
      expect(references(page.body)).toEqual([small.reference]);
    });

    it.each([
      ['an unknown status', { status: 'DONE' }, 'status'],
      ['a malformed account id', { accountId: 'c-1' }, 'accountId'],
    ])('refuses %s with a French 400', async (_, query, field) => {
      const response = await staffList(query).expect(400);

      expect(response.body.details).toContainEqual(
        expect.objectContaining({ field }),
      );
    });

    it('answers 404 to a member of another store, whose list stays empty', async () => {
      await prepare(10);

      await staffList({}, outsider).expect(404);
      const theirs = await api()
        .get(`/api/v1/stores/${otherStoreId}/orders`)
        .set('Authorization', outsider.authorization)
        .expect(200);
      expect(theirs.body.total).toBe(0);
    });
  });

  describe('GET /me/accounts/:accountId/orders', () => {
    it('lists the customer’s orders only, without staff identities', async () => {
      const mine = await prepare(10);
      await prepare(5, otherAccountId);
      await api()
        .post(`/api/v1/stores/${storeId}/orders/${mine.id}/cancel`)
        .set('Authorization', manager.authorization)
        .send({ reason: 'Erreur de saisie' })
        .expect(200);

      const response = await myList().expect(200);

      expect(response.body).toMatchObject({ total: 1 });
      expect(response.body.items[0]).toMatchObject({
        id: mine.id,
        status: 'CANCELLED',
        cancellationReason: 'Erreur de saisie',
        store: { id: storeId, name: 'Quincaillerie du Carrefour' },
        total: '50000',
      });
      const json = JSON.stringify(response.body);
      for (const key of ['createdBy', 'validatedBy', 'cancelledBy']) {
        expect(json).not.toContain(`"${key}"`);
      }
      expect(json).not.toContain(seller.userId);
      expect(json).not.toContain(manager.userId);
    });

    it('shows the manager’s refusal reason to the customer (F-11, user decision)', async () => {
      const large = await prepare(50);
      await api()
        .post(`/api/v1/stores/${storeId}/orders/${large.id}/refuse`)
        .set('Authorization', manager.authorization)
        .send({ reason: 'Montant trop élevé pour un seul bon' })
        .expect(200);

      const response = await api()
        .get(`/api/v1/me/accounts/${accountId}/orders/${large.id}`)
        .set('Authorization', customer.authorization)
        .expect(200);

      expect(response.body).toMatchObject({
        status: 'REFUSED_BY_MANAGER',
        refusalReason: 'Montant trop élevé pour un seul bon',
        refusedAt: expect.any(String),
      });
      expect(response.body).not.toHaveProperty('refusedBy');
    });

    it('filters by status', async () => {
      await prepare(10);
      const large = await prepare(50);

      expect(
        references(
          (await myList({ status: 'AWAITING_VALIDATION' }).expect(200)).body,
        ),
      ).toEqual([large.reference]);
    });

    it('answers 404 to another customer and to staff', async () => {
      for (const as of [other, seller]) {
        await myList({}, as)
          .expect(404)
          .expect((r) => expect(r.body.message).toBe('Compte introuvable'));
      }
    });
  });

  describe('GET /me/accounts/:accountId/orders/:orderId', () => {
    it('gives the customer one of their orders', async () => {
      const order = await prepare(10);

      const response = await api()
        .get(`/api/v1/me/accounts/${accountId}/orders/${order.id}`)
        .set('Authorization', customer.authorization)
        .expect(200);

      expect(response.body).toMatchObject({
        id: order.id,
        reference: order.reference,
        status: 'AWAITING_CUSTOMER',
        store: { id: storeId },
      });
      expect(response.body).not.toHaveProperty('createdBy');
    });

    it('answers 404 for an order of another account, even the customer’s neighbour', async () => {
      const theirs = await prepare(5, otherAccountId);

      await api()
        .get(`/api/v1/me/accounts/${accountId}/orders/${theirs.id}`)
        .set('Authorization', customer.authorization)
        .expect(404)
        .expect((r) => expect(r.body.message).toBe('Bon introuvable'));
      await api()
        .get(`/api/v1/me/accounts/${otherAccountId}/orders/${theirs.id}`)
        .set('Authorization', customer.authorization)
        .expect(404)
        .expect((r) => expect(r.body.message).toBe('Compte introuvable'));
    });

    it('refuses a malformed order id with a French 400', async () => {
      await api()
        .get(`/api/v1/me/accounts/${accountId}/orders/b-1`)
        .set('Authorization', customer.authorization)
        .expect(400)
        .expect((r) =>
          expect(r.body.message).toBe('Identifiant de bon invalide'),
        );
    });
  });
});
