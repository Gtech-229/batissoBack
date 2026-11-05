import type { INestApplication } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { SchedulerRegistry } from '@nestjs/schedule';
import { DELIVERY_ALERTS_JOB } from '../src/admin-alerts/delivery-alerts.job.js';
import { DeliveryAlertsService } from '../src/admin-alerts/delivery-alerts.service.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { createAdmin } from './utils/admins.js';
import { accessCookieFor, createTestApp } from './utils/app.js';
import { createMali, createStoreRecord } from './utils/countries.js';
import { CapturingPushSender } from './utils/push.js';
import { resetDatabase } from './utils/reset-database.js';
import { CapturingSmsSender } from './utils/sms.js';
import { signedInStaff, type MobileStaff } from './utils/staff.js';
import { TEST_PIN } from './utils/users.js';

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

describe('Delivery alerts (e2e)', () => {
  const sms = new CapturingSmsSender();
  const push = new CapturingPushSender();
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let alertsJob: DeliveryAlertsService;
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
    alertsJob = app.get(DeliveryAlertsService);
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
    await prisma.userDevice.updateMany({
      where: { deviceId: manager.deviceId },
      data: { pushToken: 'token-manager-phone' },
    });
    await settled();
    sms.clear();
    push.clear();
  });

  // Let every dispatch finish before the next reset deletes its rows.
  afterEach(async () => {
    await settled();
  });

  afterAll(async () => {
    await app.close();
  });

  const api = () => request(app.getHttpServer());
  /** A 20 000 order the customer confirmed with their PIN (paid, not delivered). */
  const confirmed = async () => {
    const order = (
      await api()
        .post(`/api/v1/stores/${storeId}/accounts/${accountId}/orders`)
        .set('Authorization', seller.authorization)
        .send({ lines: [{ articleId: cementId, quantity: 4 }] })
        .expect(201)
    ).body as { id: string; reference: string };
    await api()
      .post(`/api/v1/me/accounts/${accountId}/orders/${order.id}/confirm`)
      .set('Authorization', customer.authorization)
      .set('Idempotency-Key', randomUUID())
      .send({ pin: TEST_PIN })
      .expect(201);
    return order;
  };
  /** The test seam for time: the confirmation moved `days` back from `now`. */
  const confirmedDaysAgo = async (days: number, now = new Date()) => {
    const order = await confirmed();
    await prisma.materialOrder.update({
      where: { id: order.id },
      data: { confirmedAt: new Date(now.getTime() - days * DAY_MS) },
    });
    return order;
  };
  const overdueAlerts = () =>
    prisma.notification.findMany({
      where: { type: 'ORDER_DELIVERY_OVERDUE' },
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
  };

  describe('alertOverdueDeliveries', () => {
    it('alerts the active manager once, in the app and by push, not by SMS', async () => {
      const now = new Date();
      const { id, reference } = await confirmedDaysAgo(8, now);
      await settled();
      sms.clear();
      push.clear();

      const result = await alertsJob.alertOverdueDeliveries(now);
      await settled();

      expect(result).toEqual({ ordersAlerted: 1 });
      const rows = await overdueAlerts();
      expect(rows.map((row) => [row.channel, row.userId])).toEqual([
        ['APP', manager.userId],
        ['PUSH', manager.userId],
      ]);
      expect(rows[0]).toMatchObject({
        title: 'Bon payé toujours pas livré',
        body: `Le bon ${reference} de 20 000 XOF (compte ${accountNumber}) est payé depuis 8 jours et n’est toujours pas livré. Livrez-le au client.`,
        storeId,
      });
      expect(push.messages).toEqual([
        expect.objectContaining({ title: 'Bon payé toujours pas livré' }),
      ]);
      expect(sms.messages).toEqual([]);
      const order = await prisma.materialOrder.findUniqueOrThrow({
        where: { id },
      });
      expect(order.deliveryAlertedAt).toEqual(now);
    });

    it('never alerts the same order twice, even in two parallel runs', async () => {
      const now = new Date();
      await confirmedDaysAgo(8, now);

      const [first, second] = await Promise.all([
        alertsJob.alertOverdueDeliveries(now),
        alertsJob.alertOverdueDeliveries(now),
      ]);
      const third = await alertsJob.alertOverdueDeliveries(now);

      expect(first.ordersAlerted + second.ordersAlerted).toBe(1);
      expect(third.ordersAlerted).toBe(0);
      expect(
        (await overdueAlerts()).filter((row) => row.channel === 'APP'),
      ).toHaveLength(1);
    });

    it('waits for the delay from the platform settings', async () => {
      const now = new Date();
      await confirmedDaysAgo(6, now);

      expect(await alertsJob.alertOverdueDeliveries(now)).toEqual({
        ordersAlerted: 0,
      });

      await prisma.systemSettings.create({
        data: {
          id: 1,
          maxLoginAttempts: 5,
          maxAdminSessions: 3,
          deliveryAlertDays: 5,
        },
      });
      expect(await alertsJob.alertOverdueDeliveries(now)).toEqual({
        ordersAlerted: 1,
      });
    });

    it('alerts exactly at the delay, not a second before', async () => {
      const now = new Date();
      const { id } = await confirmed();
      await prisma.materialOrder.update({
        where: { id },
        data: { confirmedAt: new Date(now.getTime() - 7 * DAY_MS + 1000) },
      });
      expect(await alertsJob.alertOverdueDeliveries(now)).toEqual({
        ordersAlerted: 0,
      });

      await prisma.materialOrder.update({
        where: { id },
        data: { confirmedAt: new Date(now.getTime() - 7 * DAY_MS) },
      });
      expect(await alertsJob.alertOverdueDeliveries(now)).toEqual({
        ordersAlerted: 1,
      });
    });

    it.each([
      ['delivered', { status: 'DELIVERED' as const, deliveredAt: new Date() }],
      [
        'cancelled after debit',
        { status: 'CANCELLED_AFTER_DEBIT' as const, cancelledAt: new Date() },
      ],
    ])('does not alert an order %s', async (_, data) => {
      const now = new Date();
      const { id } = await confirmedDaysAgo(8, now);
      await prisma.materialOrder.update({ where: { id }, data });

      expect(await alertsJob.alertOverdueDeliveries(now)).toEqual({
        ordersAlerted: 0,
      });
      expect(await overdueAlerts()).toEqual([]);
    });

    it('skips a CLOSED store and alerts a SUSPENDED one', async () => {
      const now = new Date();
      await confirmedDaysAgo(8, now);
      await prisma.hardwareStore.update({
        where: { id: storeId },
        data: { status: 'CLOSED' },
      });
      expect(await alertsJob.alertOverdueDeliveries(now)).toEqual({
        ordersAlerted: 0,
      });

      await prisma.hardwareStore.update({
        where: { id: storeId },
        data: { status: 'SUSPENDED' },
      });
      expect(await alertsJob.alertOverdueDeliveries(now)).toEqual({
        ordersAlerted: 1,
      });
    });

    it('alerts no seller and no inactive manager', async () => {
      await signedInStaff(app, prisma, {
        phone: '+22376000009',
        store: { id: storeId, role: 'MANAGER', active: false },
      });
      const now = new Date();
      await confirmedDaysAgo(8, now);

      await alertsJob.alertOverdueDeliveries(now);

      const recipients = new Set((await overdueAlerts()).map((r) => r.userId));
      expect([...recipients]).toEqual([manager.userId]);
    });
  });

  /** A paid order whose customer asked to cancel it `hours` before `now`. */
  const requestedHoursAgo = async (hours: number, now = new Date()) => {
    const order = await confirmedDaysAgo(31, now);
    await prisma.materialOrder.update({
      where: { id: order.id },
      data: {
        cancellationRequestedAt: new Date(now.getTime() - hours * HOUR_MS),
      },
    });
    return order;
  };
  const orderAlerts = () =>
    prisma.adminAlert.findMany({
      where: { type: 'ORDER_CANCELLATION_UNANSWERED' },
    });

  describe('escalateUnansweredCancellations', () => {
    it('turns a request unanswered for 48 hours into one admin alert, listed with its order', async () => {
      const now = new Date();
      const { id, reference } = await requestedHoursAgo(49, now);

      const result = await alertsJob.escalateUnansweredCancellations(now);

      expect(result).toEqual({ requestsEscalated: 1 });
      expect(await orderAlerts()).toEqual([
        expect.objectContaining({
          storeId,
          accountId,
          orderId: id,
          goalId: null,
          difference: null,
          resolvedAt: null,
        }),
      ]);
      const order = await prisma.materialOrder.findUniqueOrThrow({
        where: { id },
      });
      expect(order.cancellationEscalatedAt).toEqual(now);

      const email = 'alerts@batisso.test';
      await createAdmin(prisma, { email, permissions: ['alerts.read'] });
      const cookie = await accessCookieFor(app, email);
      const listed = await api()
        .get('/api/v1/admin/alerts?type=ORDER_CANCELLATION_UNANSWERED')
        .set('Cookie', cookie)
        .expect(200);
      expect(listed.body.items).toEqual([
        expect.objectContaining({
          type: 'ORDER_CANCELLATION_UNANSWERED',
          account: { id: accountId, number: accountNumber },
          order: { id, reference },
          goal: null,
          difference: null,
        }),
      ]);
    });

    it('escalates once, even in two parallel runs', async () => {
      const now = new Date();
      await requestedHoursAgo(49, now);

      const [first, second] = await Promise.all([
        alertsJob.escalateUnansweredCancellations(now),
        alertsJob.escalateUnansweredCancellations(now),
      ]);
      const third = await alertsJob.escalateUnansweredCancellations(now);

      expect(first.requestsEscalated + second.requestsEscalated).toBe(1);
      expect(third.requestsEscalated).toBe(0);
      expect(await orderAlerts()).toHaveLength(1);
    });

    it('gives two unanswered orders of the same account an alert each', async () => {
      const now = new Date();
      await requestedHoursAgo(49, now);
      await requestedHoursAgo(60, now);

      expect(await alertsJob.escalateUnansweredCancellations(now)).toEqual({
        requestsEscalated: 2,
      });
    });

    it('waits for the delay from the platform settings, to the second', async () => {
      const now = new Date();
      const { id } = await confirmedDaysAgo(31, now);
      await prisma.materialOrder.update({
        where: { id },
        data: {
          cancellationRequestedAt: new Date(
            now.getTime() - 48 * HOUR_MS + 1000,
          ),
        },
      });
      expect(await alertsJob.escalateUnansweredCancellations(now)).toEqual({
        requestsEscalated: 0,
      });

      await prisma.systemSettings.create({
        data: {
          id: 1,
          maxLoginAttempts: 5,
          maxAdminSessions: 3,
          cancellationEscalationHours: 24,
        },
      });
      expect(await alertsJob.escalateUnansweredCancellations(now)).toEqual({
        requestsEscalated: 1,
      });
    });

    it.each([
      ['delivered', { status: 'DELIVERED' as const, deliveredAt: new Date() }],
      [
        'cancelled after debit',
        { status: 'CANCELLED_AFTER_DEBIT' as const, cancelledAt: new Date() },
      ],
    ])('does not escalate an order %s', async (_, data) => {
      const now = new Date();
      const { id } = await requestedHoursAgo(49, now);
      await prisma.materialOrder.update({ where: { id }, data });

      expect(await alertsJob.escalateUnansweredCancellations(now)).toEqual({
        requestsEscalated: 0,
      });
      expect(await orderAlerts()).toEqual([]);
    });

    it('does not escalate an order without a request', async () => {
      const now = new Date();
      await confirmedDaysAgo(40, now);

      expect(await alertsJob.escalateUnansweredCancellations(now)).toEqual({
        requestsEscalated: 0,
      });
    });

    it('escalates in a CLOSED store too: the admin is the escalation', async () => {
      const now = new Date();
      await requestedHoursAgo(49, now);
      await prisma.hardwareStore.update({
        where: { id: storeId },
        data: { status: 'CLOSED' },
      });

      expect(await alertsJob.escalateUnansweredCancellations(now)).toEqual({
        requestsEscalated: 1,
      });
    });
  });

  it('schedules the delivery alerts every hour at minute 0 UTC', () => {
    const job = app.get(SchedulerRegistry).getCronJob(DELIVERY_ALERTS_JOB);

    expect(job.cronTime.source).toBe('0 * * * *');
    expect(job.cronTime.timeZone).toBe('UTC');
    expect(job.isActive).toBe(true);
  });
});
