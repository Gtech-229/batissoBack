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

describe('Delivering material orders (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  const sms = new CapturingSmsSender();
  const push = new CapturingPushSender();
  let storeId: string;
  let otherStoreId: string;
  let manager: MobileStaff;
  let seller: MobileStaff;
  let otherSeller: MobileStaff;
  let outsider: MobileStaff;
  let customer: MobileStaff;
  let accountId: string;
  let cementId: string;

  beforeAll(async () => {
    app = await createTestApp({ sms, push });
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
    otherSeller = await signedInStaff(app, prisma, {
      phone: '+22376000003',
      firstName: 'Fanta',
      store: { id: storeId, role: 'SELLER' },
    });
    outsider = await signedInStaff(app, prisma, {
      phone: '+22376000002',
      store: { id: otherStoreId, role: 'MANAGER' },
    });
    customer = await signedInStaff(app, prisma, { phone: '+22376445566' });
    await prisma.userDevice.updateMany({
      where: { deviceId: customer.deviceId },
      data: { pushToken: 'token-customer-phone' },
    });
    const opened = await api()
      .post(`/api/v1/stores/${storeId}/accounts`)
      .set('Authorization', seller.authorization)
      .send({
        customer: { phone: customer.phone, firstName: 'F', lastName: 'K' },
        termsAccepted: true,
      })
      .expect(201);
    accountId = opened.body.id as string;
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
  /** 4 bags = 20 000 goes straight to the customer; 50 bags = 250 000 waits. */
  const prepare = async (bags = 4) =>
    (
      await api()
        .post(`/api/v1/stores/${storeId}/accounts/${accountId}/orders`)
        .set('Authorization', seller.authorization)
        .send({ lines: [{ articleId: cementId, quantity: bags }] })
        .expect(201)
    ).body as { id: string; reference: string };
  /** An order the customer confirmed with their PIN: debited, to deliver. */
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
  const deliver = (orderId: string, as = seller, store = storeId) =>
    api()
      .post(`/api/v1/stores/${store}/orders/${orderId}/deliver`)
      .set('Authorization', as.authorization);
  const setStoreStatus = (status: 'SUSPENDED' | 'CLOSED') =>
    prisma.hardwareStore.update({ where: { id: storeId }, data: { status } });
  const deliveredRows = () =>
    prisma.notification.findMany({
      where: { type: 'ORDER_DELIVERED' },
      orderBy: { channel: 'asc' },
    });
  const settled = async () => {
    for (let i = 0; i < 100; i++) {
      if (
        (await prisma.notification.count({ where: { status: 'PENDING' } })) ===
        0
      ) {
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    throw new Error('Notifications still PENDING');
  };

  it('lets the seller who prepared the order deliver it in full', async () => {
    const order = await confirmed();

    const response = await deliver(order.id).expect(200);

    expect(response.body).toMatchObject({
      id: order.id,
      status: 'DELIVERED',
      deliveredAt: expect.any(String),
      deliveredBy: {
        userId: seller.userId,
        firstName: 'Moussa',
        lastName: 'Diallo',
      },
      debitReference: expect.stringMatching(/^A-\d{5,}$/),
    });
    // Names only: never a phone of the staff.
    expect(Object.keys(response.body.deliveredBy).sort()).toEqual([
      'firstName',
      'lastName',
      'userId',
    ]);
    const deliveredAt = new Date(response.body.deliveredAt as string);
    expect(Math.abs(deliveredAt.getTime() - Date.now())).toBeLessThan(60_000);
  });

  it('lets another seller and the manager deliver too', async () => {
    for (const as of [otherSeller, manager]) {
      const order = await confirmed();

      await deliver(order.id, as)
        .expect(200)
        .expect((r) => expect(r.body.deliveredBy.userId).toBe(as.userId));
    }
  });

  it('moves no money: balance, goals, and operations are unchanged', async () => {
    const order = await confirmed();
    const before = await prisma.account.findUniqueOrThrow({
      where: { id: accountId },
      include: { goals: { orderBy: { id: 'asc' } } },
    });
    const operations = await prisma.operation.count();

    await deliver(order.id).expect(200);

    expect(
      await prisma.account.findUniqueOrThrow({
        where: { id: accountId },
        include: { goals: { orderBy: { id: 'asc' } } },
      }),
    ).toEqual(before);
    expect(await prisma.operation.count()).toBe(operations);
  });

  it('shows the delivery date to the customer, without staff identity', async () => {
    const order = await confirmed();
    const delivered = await deliver(order.id).expect(200);

    const mine = await api()
      .get(`/api/v1/me/accounts/${accountId}/orders/${order.id}`)
      .set('Authorization', customer.authorization)
      .expect(200);

    expect(mine.body).toMatchObject({
      status: 'DELIVERED',
      deliveredAt: delivered.body.deliveredAt,
    });
    expect(mine.body).not.toHaveProperty('deliveredBy');
    expect(JSON.stringify(mine.body)).not.toContain(seller.userId);
  });

  it('filters both lists on DELIVERED', async () => {
    const delivered = await confirmed();
    await deliver(delivered.id).expect(200);
    await confirmed();

    const staffList = await api()
      .get(`/api/v1/stores/${storeId}/orders?status=DELIVERED`)
      .set('Authorization', manager.authorization)
      .expect(200);
    const myList = await api()
      .get(`/api/v1/me/accounts/${accountId}/orders?status=DELIVERED`)
      .set('Authorization', customer.authorization)
      .expect(200);

    for (const list of [staffList, myList]) {
      expect(list.body.items.map((o: { id: string }) => o.id)).toEqual([
        delivered.id,
      ]);
    }
  });

  describe('refuses an order that is not confirmed with 409 ORDER_STATUS', () => {
    it('awaiting validation, then refused by the manager', async () => {
      const order = await prepare(50);
      await deliver(order.id)
        .expect(409)
        .expect((r) =>
          expect(r.body).toMatchObject({
            error: 'ORDER_STATUS',
            message:
              'Ce bon est en attente de validation : cette action n’est pas possible',
          }),
        );

      await api()
        .post(`/api/v1/stores/${storeId}/orders/${order.id}/refuse`)
        .set('Authorization', manager.authorization)
        .send({ reason: 'Non' })
        .expect(200);
      await deliver(order.id)
        .expect(409)
        .expect((r) => expect(r.body.error).toBe('ORDER_STATUS'));
    });

    it('awaiting the customer, then cancelled', async () => {
      const order = await prepare();
      await deliver(order.id)
        .expect(409)
        .expect((r) => expect(r.body.error).toBe('ORDER_STATUS'));

      await api()
        .post(`/api/v1/stores/${storeId}/orders/${order.id}/cancel`)
        .set('Authorization', seller.authorization)
        .send({})
        .expect(200);
      await deliver(order.id)
        .expect(409)
        .expect((r) => expect(r.body.error).toBe('ORDER_STATUS'));
    });

    it('refused by the customer', async () => {
      const order = await prepare();
      await api()
        .post(`/api/v1/me/accounts/${accountId}/orders/${order.id}/refuse`)
        .set('Authorization', customer.authorization)
        .send({})
        .expect(200);

      await deliver(order.id)
        .expect(409)
        .expect((r) => expect(r.body.error).toBe('ORDER_STATUS'));
    });

    it('already delivered, keeping the first delivery', async () => {
      const order = await confirmed();
      const first = await deliver(order.id).expect(200);

      await deliver(order.id, manager)
        .expect(409)
        .expect((r) =>
          expect(r.body.message).toBe(
            'Ce bon est livré : cette action n’est pas possible',
          ),
        );
      const detail = await api()
        .get(`/api/v1/stores/${storeId}/orders/${order.id}`)
        .set('Authorization', manager.authorization)
        .expect(200);
      expect(detail.body).toMatchObject({
        deliveredAt: first.body.deliveredAt,
        deliveredBy: { userId: seller.userId },
      });
    });
  });

  it('delivers once out of two parallel requests, the other gets 409', async () => {
    const order = await confirmed();

    const statuses = (
      await Promise.all([deliver(order.id), deliver(order.id, manager)])
    )
      .map((r) => [r.status, r.status === 409 ? r.body.error : null])
      .sort((a, b) => Number(a[0]) - Number(b[0]));

    expect(statuses).toEqual([
      [200, null],
      [409, 'ORDER_STATUS'],
    ]);
  });

  it('delivers in a suspended store and in a closed one: the customer has paid', async () => {
    for (const status of ['SUSPENDED', 'CLOSED'] as const) {
      const order = await confirmed();
      await setStoreStatus(status);

      await deliver(order.id)
        .expect(200)
        .expect((r) => expect(r.body.status).toBe('DELIVERED'));
      await prisma.hardwareStore.update({
        where: { id: storeId },
        data: { status: 'VERIFIED' },
      });
    }
  });

  it('answers 404 for another store’s order, a non-member, and the customer', async () => {
    const order = await confirmed();

    await deliver(order.id, outsider, otherStoreId)
      .expect(404)
      .expect((r) => expect(r.body.message).toBe('Bon introuvable'));
    for (const as of [outsider, customer]) {
      await deliver(order.id, as)
        .expect(404)
        .expect((r) =>
          expect(r.body.message).toBe('Quincaillerie introuvable'),
        );
    }
    await deliver(randomUUID())
      .expect(404)
      .expect((r) => expect(r.body.message).toBe('Bon introuvable'));
    expect(
      (
        await prisma.materialOrder.findUniqueOrThrow({
          where: { id: order.id },
        })
      ).status,
    ).toBe('CONFIRMED');
  });

  it('answers 400 for a malformed order id', async () => {
    await deliver('b-1')
      .expect(400)
      .expect((r) => expect(r.body.statusCode).toBe(400));
  });

  describe('ORDER_DELIVERED', () => {
    /** A confirmed order, with the notifications of its earlier steps sent. */
    const confirmedQuietly = async () => {
      const order = await confirmed();
      await settled();
      sms.clear();
      push.clear();
      return order;
    };

    it('tells the customer in the app and by push, not by SMS', async () => {
      const order = await confirmedQuietly();

      await deliver(order.id).expect(200);
      await settled();

      const rows = await deliveredRows();
      expect(rows.map((row) => [row.channel, row.userId])).toEqual([
        ['APP', customer.userId],
        ['PUSH', customer.userId],
      ]);
      expect(rows[0]).toMatchObject({
        title: 'Bon livré',
        body: `Le bon ${order.reference} de 20 000 XOF chez Quincaillerie du Carrefour vous a été livré.`,
        storeId,
        operationId: null,
      });
      expect(push.messages).toEqual([
        expect.objectContaining({ title: 'Bon livré' }),
      ]);
      // No money moves at delivery: no SMS.
      expect(sms.messages).toEqual([]);
    });

    it('tells nothing when the delivery is refused', async () => {
      const order = await confirmedQuietly();
      await deliver(order.id).expect(200);
      await settled();
      push.clear();

      await deliver(order.id, manager).expect(409);
      await deliver((await prepare()).id).expect(409);
      await settled();

      expect(await deliveredRows()).toHaveLength(2);
      expect(push.messages).not.toContainEqual(
        expect.objectContaining({ title: 'Bon livré' }),
      );
    });
  });
});
