import type { INestApplication } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { createTestApp } from './utils/app.js';
import { createMali, createStoreRecord } from './utils/countries.js';
import { CapturingPushSender } from './utils/push.js';
import { resetDatabase } from './utils/reset-database.js';
import { CapturingSmsSender } from './utils/sms.js';
import { signedInStaff, type MobileStaff } from './utils/staff.js';
import { TEST_PIN } from './utils/users.js';

const DAY_MS = 24 * 60 * 60 * 1000;

describe('The customer asks to cancel an undelivered order (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  const sms = new CapturingSmsSender();
  const push = new CapturingPushSender();
  let storeId: string;
  let manager: MobileStaff;
  let seller: MobileStaff;
  let customer: MobileStaff;
  let other: MobileStaff;
  let accountId: string;
  let accountNumber: string;
  let cementId: string;

  beforeAll(async () => {
    app = await createTestApp({ sms, push });
    prisma = app.get(PrismaService);
  });

  beforeEach(async () => {
    await resetDatabase(prisma);
    await createMali(prisma);
    storeId = (await createStoreRecord(prisma, { status: 'VERIFIED' })).id;
    manager = await signedInStaff(app, prisma, {
      phone: '+22376000000',
      store: { id: storeId, role: 'MANAGER' },
    });
    seller = await signedInStaff(app, prisma, {
      phone: '+22376000001',
      store: { id: storeId, role: 'SELLER' },
    });
    customer = await signedInStaff(app, prisma, { phone: '+22376445566' });
    other = await signedInStaff(app, prisma, { phone: '+22376112233' });
    const opened = await api()
      .post(`/api/v1/stores/${storeId}/accounts`)
      .set('Authorization', seller.authorization)
      .send({
        customer: { phone: customer.phone, firstName: 'F', lastName: 'K' },
        termsAccepted: true,
      })
      .expect(201);
    accountId = opened.body.id as string;
    accountNumber = opened.body.number as string;
    await api()
      .post(`/api/v1/stores/${storeId}/accounts/${accountId}/deposits`)
      .set('Authorization', seller.authorization)
      .set('Idempotency-Key', randomUUID())
      .send({ amount: '300000' })
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
  const prepare = async () =>
    (
      await api()
        .post(`/api/v1/stores/${storeId}/accounts/${accountId}/orders`)
        .set('Authorization', seller.authorization)
        .send({ lines: [{ articleId: cementId, quantity: 4 }] })
        .expect(201)
    ).body as { id: string; reference: string };
  /** An order the customer confirmed with their PIN (paid, not delivered). */
  const confirmed = async () => {
    const order = await prepare();
    await api()
      .post(`/api/v1/me/accounts/${accountId}/orders/${order.id}/confirm`)
      .set('Authorization', customer.authorization)
      .set('Idempotency-Key', randomUUID())
      .send({ pin: TEST_PIN })
      .expect(201);
    return order;
  };
  /** The test seam for time: the confirmation moved `days` (and a second) back. */
  const confirmedDaysAgo = async (days: number, orderId?: string) => {
    const id = orderId ?? (await confirmed()).id;
    await prisma.materialOrder.update({
      where: { id },
      data: { confirmedAt: new Date(Date.now() - days * DAY_MS - 1000) },
    });
    return id;
  };
  const ask = (
    orderId: string,
    body: Record<string, unknown> = {},
    as = customer,
  ) =>
    api()
      .post(
        `/api/v1/me/accounts/${accountId}/orders/${orderId}/cancellation-request`,
      )
      .set('Authorization', as.authorization)
      .send(body);
  const storedOrder = (id: string) =>
    prisma.materialOrder.findUniqueOrThrow({ where: { id } });
  const setDelay = (deliveryDelayDays: number) =>
    prisma.storeSettings.update({
      where: { storeId },
      data: { deliveryDelayDays },
    });

  it('records the request with its reason, and the order stays CONFIRMED', async () => {
    const orderId = await confirmedDaysAgo(30);

    const response = await ask(orderId, {
      reason: '  Toujours pas livré après un mois ',
    }).expect(200);

    expect(response.body).toMatchObject({
      id: orderId,
      status: 'CONFIRMED',
      cancellationRequestedAt: expect.any(String),
      cancellationRequestReason: 'Toujours pas livré après un mois',
    });
    const staff = await api()
      .get(`/api/v1/stores/${storeId}/orders/${orderId}`)
      .set('Authorization', manager.authorization)
      .expect(200);
    expect(staff.body).toMatchObject({
      status: 'CONFIRMED',
      cancellationRequestedAt: response.body.cancellationRequestedAt,
      cancellationRequestReason: 'Toujours pas livré après un mois',
    });
  });

  it('records a request without a reason', async () => {
    const orderId = await confirmedDaysAgo(31);

    await ask(orderId)
      .expect(200)
      .expect((r) => expect(r.body.cancellationRequestReason).toBeNull());
  });

  it('refuses before the delay with 409 DELIVERY_DELAY_NOT_REACHED, giving the date', async () => {
    const order = await confirmed();
    const { confirmedAt } = await storedOrder(order.id);
    const opensAt = new Date(confirmedAt!.getTime() + 30 * DAY_MS);
    const two = (n: number) => String(n).padStart(2, '0');
    const date = `${two(opensAt.getUTCDate())}/${two(opensAt.getUTCMonth() + 1)}/${opensAt.getUTCFullYear()}`;

    await ask(order.id)
      .expect(409)
      .expect((r) =>
        expect(r.body).toMatchObject({
          error: 'DELIVERY_DELAY_NOT_REACHED',
          message: `Vous pourrez demander l’annulation de ce bon à partir du ${date}`,
        }),
      );
    expect((await storedOrder(order.id)).cancellationRequestedAt).toBeNull();
  });

  it('follows the store’s own delivery delay', async () => {
    await setDelay(45);
    const orderId = await confirmedDaysAgo(30);

    await ask(orderId)
      .expect(409)
      .expect((r) => expect(r.body.error).toBe('DELIVERY_DELAY_NOT_REACHED'));

    await confirmedDaysAgo(45, orderId);
    await ask(orderId).expect(200);
  });

  it('takes one request per order: a second one gets 409 CANCELLATION_ALREADY_REQUESTED', async () => {
    const orderId = await confirmedDaysAgo(30);
    const first = await ask(orderId, { reason: 'Premier' }).expect(200);

    await ask(orderId, { reason: 'Second' })
      .expect(409)
      .expect((r) =>
        expect(r.body.error).toBe('CANCELLATION_ALREADY_REQUESTED'),
      );
    expect(await storedOrder(orderId)).toMatchObject({
      cancellationRequestedAt: new Date(
        first.body.cancellationRequestedAt as string,
      ),
      cancellationRequestReason: 'Premier',
    });
  });

  it('records once out of two parallel requests', async () => {
    const orderId = await confirmedDaysAgo(30);

    const responses = await Promise.all([ask(orderId), ask(orderId)]);

    expect(
      responses
        .map((r) => [r.status, r.status === 409 ? r.body.error : null])
        .sort((a, b) => Number(a[0]) - Number(b[0])),
    ).toEqual([
      [200, null],
      [409, 'CANCELLATION_ALREADY_REQUESTED'],
    ]);
  });

  it('refuses an order that is not confirmed and undelivered with 409 ORDER_STATUS', async () => {
    const waiting = await prepare();
    const delivered = await confirmedDaysAgo(30);
    await api()
      .post(`/api/v1/stores/${storeId}/orders/${delivered}/deliver`)
      .set('Authorization', seller.authorization)
      .expect(200);
    const cancelled = await confirmedDaysAgo(30);
    await api()
      .post(`/api/v1/stores/${storeId}/orders/${cancelled}/cancel-after-debit`)
      .set('Authorization', manager.authorization)
      .set('Idempotency-Key', randomUUID())
      .send({ reason: 'Rupture de stock' })
      .expect(201);

    for (const [orderId, label] of [
      [waiting.id, 'en attente du client'],
      [delivered, 'livré'],
      [cancelled, 'annulé après débit'],
    ]) {
      await ask(orderId)
        .expect(409)
        .expect((r) =>
          expect(r.body).toMatchObject({
            error: 'ORDER_STATUS',
            message: `Ce bon est ${label} : cette action n’est pas possible`,
          }),
        );
    }
  });

  it('answers 404 to another customer, to staff, and for an unknown order', async () => {
    const orderId = await confirmedDaysAgo(30);

    for (const as of [other, seller, manager]) {
      await ask(orderId, {}, as)
        .expect(404)
        .expect((r) => expect(r.body.message).toBe('Compte introuvable'));
    }
    await ask(randomUUID())
      .expect(404)
      .expect((r) => expect(r.body.message).toBe('Bon introuvable'));
    expect((await storedOrder(orderId)).cancellationRequestedAt).toBeNull();
  });

  it('refuses malformed ids and a reason over 500 characters with 400', async () => {
    const orderId = await confirmedDaysAgo(30);

    await ask('b-1').expect(400);
    await api()
      .post(`/api/v1/me/accounts/c-1/orders/${orderId}/cancellation-request`)
      .set('Authorization', customer.authorization)
      .send({})
      .expect(400);
    await ask(orderId, { reason: 'x'.repeat(501) })
      .expect(400)
      .expect((r) =>
        expect(r.body.details).toContainEqual(
          expect.objectContaining({ field: 'reason' }),
        ),
      );
    expect((await storedOrder(orderId)).cancellationRequestedAt).toBeNull();
  });

  it('accepts the request in a suspended store and in a closed one', async () => {
    for (const status of ['SUSPENDED', 'CLOSED'] as const) {
      const orderId = await confirmedDaysAgo(30);
      await prisma.hardwareStore.update({
        where: { id: storeId },
        data: { status },
      });

      await ask(orderId).expect(200);
      await prisma.hardwareStore.update({
        where: { id: storeId },
        data: { status: 'VERIFIED' },
      });
    }
  });

  it('still lets the manager deliver or cancel with re-credit, keeping the request', async () => {
    const toDeliver = await confirmedDaysAgo(30);
    const toCancel = await confirmedDaysAgo(30);
    await ask(toDeliver, { reason: 'Livrez ou remboursez' }).expect(200);
    await ask(toCancel).expect(200);

    await api()
      .post(`/api/v1/stores/${storeId}/orders/${toDeliver}/deliver`)
      .set('Authorization', seller.authorization)
      .expect(200)
      .expect((r) =>
        expect(r.body).toMatchObject({
          status: 'DELIVERED',
          cancellationRequestReason: 'Livrez ou remboursez',
          cancellationRequestedAt: expect.any(String),
        }),
      );
    await api()
      .post(`/api/v1/stores/${storeId}/orders/${toCancel}/cancel-after-debit`)
      .set('Authorization', manager.authorization)
      .set('Idempotency-Key', randomUUID())
      .send({ reason: 'Rupture de stock' })
      .expect(201)
      .expect((r) =>
        expect(r.body).toMatchObject({
          status: 'CANCELLED_AFTER_DEBIT',
          cancellationRequestedAt: expect.any(String),
          recreditReference: expect.stringMatching(/^R-\d{5,}$/),
        }),
      );
  });

  describe('ORDER_CANCELLATION_REQUESTED', () => {
    const alerts = () =>
      prisma.notification.findMany({
        where: { type: 'ORDER_CANCELLATION_REQUESTED' },
        orderBy: { channel: 'asc' },
      });
    const settled = async () => {
      for (let i = 0; i < 100; i++) {
        if (
          (await prisma.notification.count({
            where: { status: 'PENDING' },
          })) === 0
        ) {
          return;
        }
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      throw new Error('Notifications still PENDING');
    };
    /** An order past the delay, with the notifications of its earlier steps sent. */
    const requestable = async () => {
      const orderId = await confirmedDaysAgo(30);
      const { reference } = await storedOrder(orderId);
      await settled();
      sms.clear();
      push.clear();
      return { orderId, reference };
    };

    it('alerts the active manager in the app and by push, not by SMS', async () => {
      await prisma.userDevice.updateMany({
        where: { deviceId: manager.deviceId },
        data: { pushToken: 'token-manager-phone' },
      });
      const { orderId, reference } = await requestable();

      await ask(orderId, { reason: 'Toujours pas livré' }).expect(200);
      await settled();

      const rows = await alerts();
      expect(rows.map((row) => [row.channel, row.userId])).toEqual([
        ['APP', manager.userId],
        ['PUSH', manager.userId],
      ]);
      expect(rows[0]).toMatchObject({
        title: 'Demande d’annulation d’un bon',
        body: `Le client du compte ${accountNumber} demande l’annulation du bon ${reference} de 20 000 XOF, toujours pas livré. Livrez-le ou annulez-le avec remboursement. Motif : « Toujours pas livré ».`,
        storeId,
        operationId: null,
      });
      expect(push.messages).toEqual([
        expect.objectContaining({ title: 'Demande d’annulation d’un bon' }),
      ]);
      expect(sms.messages).toEqual([]);
    });

    it('leaves the reason out of the alert when there is none', async () => {
      const { orderId, reference } = await requestable();

      await ask(orderId).expect(200);

      expect((await alerts())[0].body).toBe(
        `Le client du compte ${accountNumber} demande l’annulation du bon ${reference} de 20 000 XOF, toujours pas livré. Livrez-le ou annulez-le avec remboursement.`,
      );
    });

    it('alerts no seller and no inactive manager', async () => {
      const former = await signedInStaff(app, prisma, {
        phone: '+22376000009',
        store: { id: storeId, role: 'MANAGER', active: false },
      });
      const { orderId } = await requestable();

      await ask(orderId).expect(200);

      const recipients = new Set((await alerts()).map((row) => row.userId));
      expect([...recipients]).toEqual([manager.userId]);
      expect(recipients.has(seller.userId)).toBe(false);
      expect(recipients.has(former.userId)).toBe(false);
    });

    it('alerts nobody when the request is refused', async () => {
      const order = await confirmed();
      const { orderId } = await requestable();
      await ask(orderId).expect(200);

      await ask(order.id).expect(409);
      await ask(orderId).expect(409);
      await ask(orderId, {}, other).expect(404);

      expect(await alerts()).toHaveLength(1);
    });
  });
});
