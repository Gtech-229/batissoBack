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

describe('The customer refuses an order (e2e)', () => {
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
    await prisma.userDevice.updateMany({
      where: { deviceId: manager.deviceId },
      data: { pushToken: 'token-manager-phone' },
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
    accountNumber = opened.body.number as string;
    await api()
      .post(`/api/v1/stores/${storeId}/accounts/${accountId}/deposits`)
      .set('Authorization', seller.authorization)
      .set('Idempotency-Key', randomUUID())
      .send({ amount: '100000' })
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
    await settled();
    sms.clear();
    push.clear();
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
  const refuse = (
    orderId: string,
    body: Record<string, unknown> = {},
    as = customer,
  ) =>
    api()
      .post(`/api/v1/me/accounts/${accountId}/orders/${orderId}/refuse`)
      .set('Authorization', as.authorization)
      .send(body);
  const refusalAlerts = () =>
    prisma.notification.findMany({
      where: { type: 'ORDER_REFUSED_BY_CUSTOMER' },
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

  it('refuses the order with a reason, and alerts the manager in the app and by push', async () => {
    const order = await prepare();

    const response = await refuse(order.id, {
      reason: '  Je n’ai pas demandé ces articles ',
    }).expect(200);
    await settled();

    expect(response.body).toMatchObject({
      id: order.id,
      status: 'REFUSED_BY_CUSTOMER',
      customerRefusedAt: expect.any(String),
      customerRefusalReason: 'Je n’ai pas demandé ces articles',
      debitReference: null,
    });
    const alerts = await refusalAlerts();
    expect(alerts.map((row) => [row.channel, row.userId])).toEqual([
      ['APP', manager.userId],
      ['PUSH', manager.userId],
    ]);
    expect(alerts[0]).toMatchObject({
      title: 'Bon refusé par le client',
      body: `Le client du compte ${accountNumber} a refusé le bon ${order.reference} de 20 000 XOF. Motif : « Je n’ai pas demandé ces articles ».`,
      storeId,
      operationId: null,
    });
    expect(push.messages).toEqual([
      expect.objectContaining({ title: 'Bon refusé par le client' }),
    ]);
    // No money moved: no SMS, no debit.
    expect(sms.messages).toEqual([]);
    expect(
      await prisma.operation.count({ where: { type: 'MATERIAL_DEBIT' } }),
    ).toBe(0);
  });

  it('refuses without a reason', async () => {
    const order = await prepare();

    await refuse(order.id)
      .expect(200)
      .expect((r) => expect(r.body.customerRefusalReason).toBeNull());
    expect((await refusalAlerts())[0].body).toMatch(/de 20 000 XOF\.$/);
  });

  it('alerts no seller, only the active manager', async () => {
    const order = await prepare();

    await refuse(order.id).expect(200);

    const recipients = new Set(
      (await refusalAlerts()).map((row) => row.userId),
    );
    expect([...recipients]).toEqual([manager.userId]);
  });

  it('refuses an order that does not await the customer with 409 ORDER_STATUS', async () => {
    const order = await prepare();
    await refuse(order.id).expect(200);

    await refuse(order.id)
      .expect(409)
      .expect((r) =>
        expect(r.body.message).toBe(
          'Ce bon est refusé par le client : cette action n’est pas possible',
        ),
      );
    expect(await refusalAlerts()).toHaveLength(2);
  });

  it('cannot be confirmed once refused', async () => {
    const order = await prepare();
    await refuse(order.id).expect(200);

    await api()
      .post(`/api/v1/me/accounts/${accountId}/orders/${order.id}/confirm`)
      .set('Authorization', customer.authorization)
      .set('Idempotency-Key', randomUUID())
      .send({ pin: '482915' })
      .expect(409)
      .expect((r) => expect(r.body.error).toBe('ORDER_STATUS'));
  });

  it('answers 404 to another customer and to staff', async () => {
    const order = await prepare();

    for (const as of [other, seller]) {
      await refuse(order.id, {}, as)
        .expect(404)
        .expect((r) => expect(r.body.message).toBe('Compte introuvable'));
    }
    await refuse(randomUUID())
      .expect(404)
      .expect((r) => expect(r.body.message).toBe('Bon introuvable'));
    expect(await refusalAlerts()).toHaveLength(0);
  });

  it('refuses a reason over 500 characters with a French 400', async () => {
    const order = await prepare();

    await refuse(order.id, { reason: 'x'.repeat(501) })
      .expect(400)
      .expect((r) =>
        expect(r.body.details).toContainEqual(
          expect.objectContaining({ field: 'reason' }),
        ),
      );
  });

  it('refuses a closed store with 409 STORE_CLOSED', async () => {
    const order = await prepare();
    await prisma.hardwareStore.update({
      where: { id: storeId },
      data: { status: 'CLOSED' },
    });

    await refuse(order.id)
      .expect(409)
      .expect((r) => expect(r.body.error).toBe('STORE_CLOSED'));
  });
});
