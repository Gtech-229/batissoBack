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

describe('Order notifications to the customer (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  const sms = new CapturingSmsSender();
  const push = new CapturingPushSender();
  let storeId: string;
  let manager: MobileStaff;
  let seller: MobileStaff;
  let customer: MobileStaff;
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
    await settled();
    sms.clear();
    push.clear();
  });

  afterAll(async () => {
    await app.close();
  });

  const api = () => request(app.getHttpServer());
  /** 4 bags = 20 000 goes straight to the customer; 50 bags = 250 000 waits. */
  const prepare = async (bags: number) =>
    (
      await api()
        .post(`/api/v1/stores/${storeId}/accounts/${accountId}/orders`)
        .set('Authorization', seller.authorization)
        .send({ lines: [{ articleId: cementId, quantity: bags }] })
        .expect(201)
    ).body as { id: string; reference: string };
  const rowsOf = (type: string) =>
    prisma.notification.findMany({
      where: { type: type as never },
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

  describe('ORDER_AWAITING_CUSTOMER', () => {
    it('tells the customer at once when an order needs no validation', async () => {
      const order = await prepare(4);
      await settled();

      const rows = await rowsOf('ORDER_AWAITING_CUSTOMER');
      expect(rows.map((row) => [row.channel, row.userId])).toEqual([
        ['APP', customer.userId],
        ['PUSH', customer.userId],
      ]);
      expect(rows[0]).toMatchObject({
        title: 'Bon à confirmer',
        body: `Le bon ${order.reference} de 20 000 XOF chez Quincaillerie du Carrefour attend votre confirmation. Rien n’est débité avant.`,
        operationId: null,
      });
      expect(push.messages).toEqual([
        expect.objectContaining({ title: 'Bon à confirmer' }),
      ]);
      // Nothing is debited yet: no SMS.
      expect(sms.messages).toEqual([]);
    });

    it('waits for the manager’s validation before telling the customer', async () => {
      const order = await prepare(50);
      await settled();
      expect(await rowsOf('ORDER_AWAITING_CUSTOMER')).toHaveLength(0);

      await api()
        .post(`/api/v1/stores/${storeId}/orders/${order.id}/validate`)
        .set('Authorization', manager.authorization)
        .expect(200);
      await settled();

      expect(
        (await rowsOf('ORDER_AWAITING_CUSTOMER')).map((row) => row.channel),
      ).toEqual(['APP', 'PUSH']);
    });

    it('tells nothing when the manager refuses the order', async () => {
      const order = await prepare(50);

      await api()
        .post(`/api/v1/stores/${storeId}/orders/${order.id}/refuse`)
        .set('Authorization', manager.authorization)
        .send({ reason: 'Non' })
        .expect(200);
      await settled();

      expect(await rowsOf('ORDER_AWAITING_CUSTOMER')).toHaveLength(0);
    });
  });

  describe('PURCHASE_RECORDED', () => {
    it('tells the customer of the debit in the app, by SMS, and by push', async () => {
      const order = await prepare(4);
      const confirmed = await api()
        .post(`/api/v1/me/accounts/${accountId}/orders/${order.id}/confirm`)
        .set('Authorization', customer.authorization)
        .set('Idempotency-Key', randomUUID())
        .send({ pin: TEST_PIN })
        .expect(201);
      await settled();

      const operation = await prisma.operation.findFirstOrThrow({
        where: { type: 'MATERIAL_DEBIT' },
      });
      const rows = await rowsOf('PURCHASE_RECORDED');
      expect(rows.map((row) => row.channel)).toEqual(['APP', 'PUSH', 'SMS']);
      expect(rows.every((row) => row.operationId === operation.id)).toBe(true);
      const body = `Achat de 20 000 XOF (bon ${order.reference}) chez Quincaillerie du Carrefour sur votre compte ${accountNumber}. Nouveau solde : 280 000 XOF. Réf. ${confirmed.body.debitReference}.`;
      expect(rows[0]).toMatchObject({ title: 'Achat enregistré', body });
      expect(sms.messages).toEqual([{ phone: customer.phone, text: body }]);
      expect(push.messages).toContainEqual(
        expect.objectContaining({ title: 'Achat enregistré' }),
      );
    });

    it('notifies once for a confirmation by SMS code too, and not again on a retry', async () => {
      const order = await prepare(4);
      await api()
        .post(`/api/v1/stores/${storeId}/orders/${order.id}/confirmation-code`)
        .set('Authorization', seller.authorization)
        .expect(201);
      const code = sms.lastCodeFor(customer.phone);
      const key = randomUUID();
      const confirm = () =>
        api()
          .post(`/api/v1/stores/${storeId}/orders/${order.id}/confirm`)
          .set('Authorization', seller.authorization)
          .set('Idempotency-Key', key)
          .send({ code });

      await confirm().expect(201);
      await confirm().expect(200);
      await settled();

      expect(
        (await rowsOf('PURCHASE_RECORDED')).map((row) => row.channel),
      ).toEqual(['APP', 'PUSH', 'SMS']);
    });

    it('notifies nothing when the debit is refused', async () => {
      const order = await prepare(4);

      await api()
        .post(`/api/v1/me/accounts/${accountId}/orders/${order.id}/confirm`)
        .set('Authorization', customer.authorization)
        .set('Idempotency-Key', randomUUID())
        .send({ pin: '111222' })
        .expect(400);
      await settled();

      expect(await rowsOf('PURCHASE_RECORDED')).toHaveLength(0);
    });
  });
});
