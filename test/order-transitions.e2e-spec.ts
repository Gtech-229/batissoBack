import type { INestApplication } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { createTestApp } from './utils/app.js';
import { createMali, createStoreRecord } from './utils/countries.js';
import { resetDatabase } from './utils/reset-database.js';
import { signedInStaff, type MobileStaff } from './utils/staff.js';

describe('Validating, refusing and cancelling orders (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let storeId: string;
  let otherStoreId: string;
  let manager: MobileStaff;
  let seller: MobileStaff;
  let otherSeller: MobileStaff;
  let outsider: MobileStaff;
  let accountId: string;
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
    otherSeller = await signedInStaff(app, prisma, {
      phone: '+22376000003',
      store: { id: storeId, role: 'SELLER' },
    });
    outsider = await signedInStaff(app, prisma, {
      phone: '+22376000002',
      store: { id: otherStoreId, role: 'MANAGER' },
    });
    const customer = await signedInStaff(app, prisma, {
      phone: '+22376445566',
    });
    accountId = (
      await api()
        .post(`/api/v1/stores/${storeId}/accounts`)
        .set('Authorization', seller.authorization)
        .send({
          customer: { phone: customer.phone, firstName: 'F', lastName: 'K' },
          termsAccepted: true,
        })
        .expect(201)
    ).body.id as string;
    await api()
      .post(`/api/v1/stores/${storeId}/accounts/${accountId}/deposits`)
      .set('Authorization', seller.authorization)
      .set('Idempotency-Key', randomUUID())
      .send({ amount: '500000' })
      .expect(201);
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
  /** 50 bags = 250 000, above the 200 000 threshold; 10 bags = 50 000, under it. */
  const prepare = async (bags: number, as = seller) =>
    (
      await api()
        .post(`/api/v1/stores/${storeId}/accounts/${accountId}/orders`)
        .set('Authorization', as.authorization)
        .send({ lines: [{ articleId: cementId, quantity: bags }] })
        .expect(201)
    ).body as { id: string; status: string };
  const awaitingValidation = () => prepare(50);
  const awaitingCustomer = () => prepare(10);
  const step = (
    orderId: string,
    action: 'validate' | 'refuse' | 'cancel',
    as: MobileStaff,
    body: Record<string, unknown> = {},
  ) =>
    api()
      .post(`/api/v1/stores/${storeId}/orders/${orderId}/${action}`)
      .set('Authorization', as.authorization)
      .send(body);
  const statusOf = async (orderId: string) =>
    (await prisma.materialOrder.findUniqueOrThrow({ where: { id: orderId } }))
      .status;

  describe('POST .../orders/:orderId/validate', () => {
    it('lets the manager send a waiting order to the customer', async () => {
      const order = await awaitingValidation();

      const response = await step(order.id, 'validate', manager).expect(200);

      expect(response.body).toMatchObject({
        status: 'AWAITING_CUSTOMER',
        validatedBy: { userId: manager.userId },
        validatedAt: expect.any(String),
        createdBy: { userId: seller.userId },
      });
    });

    it('refuses an order that is not waiting for validation with 409 ORDER_STATUS', async () => {
      const order = await awaitingCustomer();

      const response = await step(order.id, 'validate', manager).expect(409);

      expect(response.body).toMatchObject({
        error: 'ORDER_STATUS',
        message:
          'Ce bon est en attente du client : cette action n’est pas possible',
      });
    });

    it('refuses a seller with 403 STORE_ROLE_REQUIRED', async () => {
      const order = await awaitingValidation();

      await step(order.id, 'validate', seller)
        .expect(403)
        .expect((r) => expect(r.body.error).toBe('STORE_ROLE_REQUIRED'));
      expect(await statusOf(order.id)).toBe('AWAITING_VALIDATION');
    });
  });

  describe('POST .../orders/:orderId/refuse', () => {
    it('lets the manager refuse a waiting order, with its reason', async () => {
      const order = await awaitingValidation();

      const response = await step(order.id, 'refuse', manager, {
        reason: '  Quantité trop importante ',
      }).expect(200);

      expect(response.body).toMatchObject({
        status: 'REFUSED_BY_MANAGER',
        refusedBy: { userId: manager.userId },
        refusalReason: 'Quantité trop importante',
        refusedAt: expect.any(String),
        validatedBy: null,
      });
    });

    it.each([
      ['a missing reason', {}],
      ['an empty reason', { reason: '   ' }],
      ['a reason over 500 characters', { reason: 'x'.repeat(501) }],
    ])('refuses %s with a French 400', async (_, body) => {
      const order = await awaitingValidation();

      const response = await step(order.id, 'refuse', manager, body).expect(
        400,
      );

      expect(response.body.details).toContainEqual({
        field: 'reason',
        errors: ['Le motif du refus doit contenir 1 à 500 caractères'],
      });
      expect(await statusOf(order.id)).toBe('AWAITING_VALIDATION');
    });

    it('cannot refuse an order already refused', async () => {
      const order = await awaitingValidation();
      await step(order.id, 'refuse', manager, { reason: 'Non' }).expect(200);

      await step(order.id, 'refuse', manager, { reason: 'Encore non' })
        .expect(409)
        .expect((r) =>
          expect(r.body.message).toBe(
            'Ce bon est refusé par le gérant : cette action n’est pas possible',
          ),
        );
    });

    it('refuses a seller with 403', async () => {
      const order = await awaitingValidation();

      await step(order.id, 'refuse', seller, { reason: 'Non' }).expect(403);
    });
  });

  describe('POST .../orders/:orderId/cancel', () => {
    it.each([
      ['awaiting validation', () => awaitingValidation()],
      ['awaiting the customer', () => awaitingCustomer()],
    ])(
      'lets its preparer cancel an order %s, with an optional reason',
      async (_, make) => {
        const order = await make();

        const response = await step(order.id, 'cancel', seller, {
          reason: 'Le client a changé d’avis',
        }).expect(200);

        expect(response.body).toMatchObject({
          status: 'CANCELLED',
          cancelledBy: { userId: seller.userId },
          cancellationReason: 'Le client a changé d’avis',
          cancelledAt: expect.any(String),
        });
      },
    );

    it('cancels without a reason', async () => {
      const order = await awaitingCustomer();

      const response = await step(order.id, 'cancel', seller).expect(200);

      expect(response.body).toMatchObject({
        status: 'CANCELLED',
        cancellationReason: null,
      });
    });

    it('lets the manager cancel any order of the store', async () => {
      const order = await awaitingCustomer();

      await step(order.id, 'cancel', manager)
        .expect(200)
        .expect((r) => expect(r.body.cancelledBy.userId).toBe(manager.userId));
    });

    it('refuses another seller with 403 NOT_ORDER_PREPARER', async () => {
      const order = await awaitingCustomer();

      const response = await step(order.id, 'cancel', otherSeller).expect(403);

      expect(response.body).toMatchObject({
        error: 'NOT_ORDER_PREPARER',
        message:
          'Vous ne pouvez annuler que les bons que vous avez préparés : demandez au gérant',
      });
      expect(await statusOf(order.id)).toBe('AWAITING_CUSTOMER');
    });

    it.each([
      ['refused', 'refusé par le gérant'],
      ['cancelled', 'annulé'],
    ])('cannot cancel a %s order', async (state, label) => {
      const order = await awaitingValidation();
      if (state === 'refused') {
        await step(order.id, 'refuse', manager, { reason: 'Non' }).expect(200);
      } else {
        await step(order.id, 'cancel', seller).expect(200);
      }

      await step(order.id, 'cancel', manager)
        .expect(409)
        .expect((r) =>
          expect(r.body.message).toBe(
            `Ce bon est ${label} : cette action n’est pas possible`,
          ),
        );
    });

    it('refuses a reason over 500 characters and a null reason with a French 400', async () => {
      const order = await awaitingCustomer();

      for (const reason of ['x'.repeat(501), null]) {
        await step(order.id, 'cancel', seller, { reason }).expect(400);
      }
      expect(await statusOf(order.id)).toBe('AWAITING_CUSTOMER');
    });
  });

  describe('every step', () => {
    it('lets exactly one of a parallel validation and refusal win', async () => {
      // Both start only from AWAITING_VALIDATION: the second finds the status
      // changed. (Validate then cancel is a legitimate sequence: cancelling is
      // allowed while the order awaits the customer.)
      const order = await awaitingValidation();

      const responses = await Promise.all([
        step(order.id, 'validate', manager),
        step(order.id, 'refuse', manager, { reason: 'Non' }),
      ]);

      expect(responses.map((r) => r.status).sort((a, b) => a - b)).toEqual([
        200, 409,
      ]);
      const winner = responses.find((r) => r.status === 200)!;
      expect(await statusOf(order.id)).toBe(winner.body.status);
    });

    it('cancels once when two cancellations run in parallel', async () => {
      const order = await awaitingCustomer();

      const responses = await Promise.all([
        step(order.id, 'cancel', seller, { reason: 'Premier' }),
        step(order.id, 'cancel', manager, { reason: 'Second' }),
      ]);

      expect(responses.map((r) => r.status).sort((a, b) => a - b)).toEqual([
        200, 409,
      ]);
      const winner = responses.find((r) => r.status === 200)!;
      const stored = await prisma.materialOrder.findUniqueOrThrow({
        where: { id: order.id },
      });
      expect(stored.cancellationReason).toBe(winner.body.cancellationReason);
    });

    it('answers 404 for another store’s order, and refuses a closed store', async () => {
      const order = await awaitingValidation();

      await api()
        .post(`/api/v1/stores/${otherStoreId}/orders/${order.id}/validate`)
        .set('Authorization', outsider.authorization)
        .expect(404)
        .expect((r) => expect(r.body.message).toBe('Bon introuvable'));
      await step(randomUUID(), 'cancel', manager).expect(404);

      await prisma.hardwareStore.update({
        where: { id: storeId },
        data: { status: 'CLOSED' },
      });
      await step(order.id, 'validate', manager)
        .expect(409)
        .expect((r) => expect(r.body.error).toBe('STORE_CLOSED'));
      expect(await statusOf(order.id)).toBe('AWAITING_VALIDATION');
    });
  });
});
