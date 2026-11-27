import type { INestApplication } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { newQrCode } from '../src/qr-codes/qr-code.js';
import { createTestApp } from './utils/app.js';
import { createMali, createStoreRecord } from './utils/countries.js';
import { resetDatabase } from './utils/reset-database.js';
import { CapturingSmsSender } from './utils/sms.js';
import { signedInStaff, type MobileStaff } from './utils/staff.js';

const REASON = 'Client injoignable depuis six mois';

describe('Leaving a store (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let storeId: string;
  let otherStoreId: string;
  let manager: MobileStaff;
  let seller: MobileStaff;
  let customer: MobileStaff;
  let accountId: string;
  let goalId: string;
  const sms = new CapturingSmsSender();

  beforeAll(async () => {
    app = await createTestApp({ sms });
    prisma = app.get(PrismaService);
  });

  beforeEach(async () => {
    await resetDatabase(prisma);
    sms.clear();
    await createMali(prisma);
    storeId = (
      await createStoreRecord(prisma, {
        name: 'Quincaillerie Sira',
        status: 'VERIFIED',
      })
    ).id;
    otherStoreId = (
      await createStoreRecord(prisma, {
        name: 'Le Bon Ciment',
        status: 'VERIFIED',
      })
    ).id;
    manager = await signedInStaff(app, prisma, {
      phone: '+22376000010',
      store: { id: storeId, role: 'MANAGER' },
    });
    seller = await signedInStaff(app, prisma, {
      phone: '+22376000011',
      store: { id: storeId, role: 'SELLER' },
    });
    customer = await signedInStaff(app, prisma, {
      phone: '+22376123401',
      firstName: 'Fanta',
    });
    const account = await prisma.account.create({
      data: {
        number: 'C-000001',
        customerId: customer.userId,
        storeId,
        currencyCode: 'XOF',
        termsAcceptedAt: new Date(),
        openedById: seller.userId,
        goals: { create: { label: 'Non affecté', isSystem: true } },
      },
      include: { goals: true },
    });
    accountId = account.id;
    goalId = account.goals[0].id;
  });

  afterAll(async () => {
    await app.close();
  });

  const api = () => request(app.getHttpServer());
  const leave = (id = accountId, as: MobileStaff = customer) =>
    api()
      .post(`/api/v1/me/accounts/${id}/leave`)
      .set('Authorization', as.authorization);
  const close = (
    body: object = { reason: REASON },
    as: MobileStaff = manager,
    id = accountId,
    store = storeId,
  ) =>
    api()
      .post(`/api/v1/stores/${store}/accounts/${id}/close`)
      .set('Authorization', as.authorization)
      .send(body);
  const stored = () =>
    prisma.account.findUniqueOrThrow({ where: { id: accountId } });
  const closings = () =>
    prisma.activityLog.findMany({ where: { action: 'ACCOUNT_CLOSED' } });

  /** A confirmed deposit of the account: what a dispute contests. */
  const deposit = () =>
    prisma.operation.create({
      data: {
        reference: 'D-00001',
        accountId,
        storeId,
        goalId,
        type: 'DEPOSIT',
        amount: 5000n,
        direction: 'CREDIT',
        currencyCode: 'XOF',
        balanceBefore: 0n,
        balanceAfter: 5000n,
        status: 'CONFIRMED',
        channel: 'CASH',
        authorId: seller.userId,
        idempotencyKey: randomUUID(),
      },
    });
  const order = (
    status:
      | 'AWAITING_VALIDATION'
      | 'AWAITING_CUSTOMER'
      | 'CONFIRMED'
      | 'DELIVERED'
      | 'CANCELLED'
      | 'REFUSED_BY_MANAGER'
      | 'REFUSED_BY_CUSTOMER'
      | 'CANCELLED_AFTER_DEBIT',
  ) =>
    prisma.materialOrder.create({
      data: {
        reference: 'B-00001',
        storeId,
        accountId,
        goalId,
        status,
        total: 10000n,
        createdById: seller.userId,
      },
    });
  const dispute = async (status: 'OPEN' | 'ANSWERED' | 'CLOSED') =>
    prisma.dispute.create({
      data: {
        operationId: (await deposit()).id,
        accountId,
        storeId,
        openedById: customer.userId,
        status,
      },
    });

  /** The sends run after the answer: wait until none is PENDING. */
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
    throw new Error('Notifications still pending');
  };

  describe('POST /me/accounts/:accountId/leave', () => {
    it('closes the account: CLOSED, by the customer, no reason, logged', async () => {
      const response = await leave().expect(200);

      expect(response.body).toMatchObject({
        id: accountId,
        number: 'C-000001',
        status: 'CLOSED',
        balance: '0',
        closedAt: expect.any(String) as string,
        closedBy: 'CUSTOMER',
        store: { id: storeId, name: 'Quincaillerie Sira' },
      });
      expect(response.body).not.toHaveProperty('closedReason');
      expect(await stored()).toMatchObject({
        status: 'CLOSED',
        closedById: customer.userId,
        closedReason: null,
      });
      const [log] = await closings();
      expect(log).toMatchObject({
        storeId,
        userId: customer.userId,
        newValue: { accountId, number: 'C-000001', closedBy: 'CUSTOMER' },
        device: customer.deviceId,
      });
    });

    it('sends the customer no notice when they leave', async () => {
      await leave().expect(200);
      await settled();

      expect(await prisma.notification.count()).toBe(0);
      expect(sms.messages).toEqual([]);
    });

    it('keeps the closed account in the customer’s list, with its history', async () => {
      await deposit();
      await leave().expect(200);

      const mine = await api()
        .get('/api/v1/me/accounts')
        .set('Authorization', customer.authorization)
        .expect(200);
      expect(mine.body).toMatchObject([
        { id: accountId, status: 'CLOSED', closedBy: 'CUSTOMER' },
      ]);
      const operations = await api()
        .get(`/api/v1/me/accounts/${accountId}/operations`)
        .set('Authorization', customer.authorization)
        .expect(200);
      expect((operations.body as { total: number }).total).toBe(1);
    });

    it('answers 404 to an account that is not the user’s', async () => {
      const response = await leave(accountId, manager).expect(404);

      expect(response.body).toMatchObject({ message: 'Compte introuvable' });
      expect((await stored()).status).toBe('ACTIVE');
    });

    it('answers 400 to a malformed account id', async () => {
      await leave('nope').expect(400);
    });

    it('refuses an account with money, 409 ACCOUNT_NOT_EMPTY', async () => {
      await prisma.account.update({
        where: { id: accountId },
        data: { balance: 500n },
      });

      const response = await leave().expect(409);

      expect(response.body).toMatchObject({
        error: 'ACCOUNT_NOT_EMPTY',
        message:
          'Ce compte a encore un solde : il ne peut être fermé qu’à zéro, une fois l’épargne utilisée en achats de matériaux',
      });
      expect((await stored()).status).toBe('ACTIVE');
      expect(await closings()).toHaveLength(0);
    });

    it.each(['AWAITING_VALIDATION', 'AWAITING_CUSTOMER', 'CONFIRMED'] as const)(
      'refuses while an order is %s, 409 ORDER_IN_PROGRESS',
      async (status) => {
        await order(status);

        const response = await leave().expect(409);

        expect(response.body).toMatchObject({ error: 'ORDER_IN_PROGRESS' });
        expect((await stored()).status).toBe('ACTIVE');
      },
    );

    it.each([
      'DELIVERED',
      'CANCELLED',
      'REFUSED_BY_MANAGER',
      'REFUSED_BY_CUSTOMER',
      'CANCELLED_AFTER_DEBIT',
    ] as const)('lets a %s order through', async (status) => {
      await order(status);

      await leave().expect(200);
    });

    it.each(['OPEN', 'ANSWERED'] as const)(
      'refuses while a dispute is %s, 409 DISPUTE_IN_PROGRESS',
      async (status) => {
        await dispute(status);

        const response = await leave().expect(409);

        expect(response.body).toMatchObject({ error: 'DISPUTE_IN_PROGRESS' });
        expect((await stored()).status).toBe('ACTIVE');
      },
    );

    it('lets a closed dispute through', async () => {
      await dispute('CLOSED');

      await leave().expect(200);
    });

    it('refuses a suspended account, 409 ACCOUNT_SUSPENDED', async () => {
      await prisma.account.update({
        where: { id: accountId },
        data: { status: 'SUSPENDED', statusReason: 'Fraude suspectée' },
      });

      const response = await leave().expect(409);

      expect(response.body).toMatchObject({
        error: 'ACCOUNT_SUSPENDED',
        message:
          'Ce compte est suspendu par un administrateur : il ne peut pas être fermé avant sa réactivation',
      });
      expect((await stored()).status).toBe('SUSPENDED');
    });

    it('refuses an account already closed, 409 ACCOUNT_CLOSED', async () => {
      await leave().expect(200);

      const response = await leave().expect(409);

      expect(response.body).toMatchObject({ error: 'ACCOUNT_CLOSED' });
      expect(await closings()).toHaveLength(1);
    });

    it('refuses in a closed store, 409 STORE_CLOSED', async () => {
      await prisma.hardwareStore.update({
        where: { id: storeId },
        data: { status: 'CLOSED' },
      });

      const response = await leave().expect(409);

      expect(response.body).toMatchObject({ error: 'STORE_CLOSED' });
      expect((await stored()).status).toBe('ACTIVE');
    });

    it('lets the customer leave a suspended store', async () => {
      await prisma.hardwareStore.update({
        where: { id: storeId },
        data: { status: 'SUSPENDED' },
      });

      await leave().expect(200);
    });
  });

  describe('a closed account refuses changes, 409 ACCOUNT_CLOSED', () => {
    const CLOSED = { error: 'ACCOUNT_CLOSED' };

    /** Closed by its customer, with an older deposit to contest or correct. */
    const closedWithHistory = async () => {
      const operation = await deposit();
      await leave().expect(200);
      return operation;
    };

    it('refuses a deposit', async () => {
      await leave().expect(200);

      const response = await api()
        .post(`/api/v1/stores/${storeId}/accounts/${accountId}/deposits`)
        .set('Authorization', seller.authorization)
        .set('Idempotency-Key', randomUUID())
        .send({ amount: '5000' })
        .expect(409);

      expect(response.body).toMatchObject({
        error: 'ACCOUNT_CLOSED',
        message:
          'Ce compte est fermé : il ne prend plus de dépôts, d’achats ni de mouvements entre objectifs. Rejoindre de nouveau la quincaillerie le rouvre.',
      });
      expect(await prisma.operation.count()).toBe(0);
    });

    it('refuses a goal move and a goal closing', async () => {
      const target = await prisma.goal.create({
        data: { accountId, label: 'Ciment', targetAmount: 50000n },
      });
      await leave().expect(200);

      // Refused for the closing before any balance check.
      const move = await api()
        .post(`/api/v1/me/accounts/${accountId}/goal-movements`)
        .set('Authorization', customer.authorization)
        .set('Idempotency-Key', randomUUID())
        .send({ sourceGoalId: goalId, targetGoalId: target.id, amount: '1000' })
        .expect(409);
      expect(move.body).toMatchObject(CLOSED);
      expect(await prisma.goalMovement.count()).toBe(0);

      const closing = await api()
        .post(`/api/v1/me/accounts/${accountId}/goals/${target.id}/close`)
        .set('Authorization', customer.authorization)
        .expect(409);
      expect(closing.body).toMatchObject(CLOSED);
      expect(
        (await prisma.goal.findUniqueOrThrow({ where: { id: target.id } }))
          .status,
      ).toBe('IN_PROGRESS');
    });

    it('refuses an order', async () => {
      const categoryId = (
        await prisma.articleCategory.create({
          data: { storeId, name: 'Ciment' },
        })
      ).id;
      const articleId = (
        await prisma.article.create({
          data: {
            storeId,
            categoryId,
            name: 'Ciment CPA 45',
            unit: 'sac de 50 kg',
            currentPrice: 5000n,
            available: true,
          },
        })
      ).id;
      await leave().expect(200);

      const response = await api()
        .post(`/api/v1/stores/${storeId}/accounts/${accountId}/orders`)
        .set('Authorization', seller.authorization)
        .send({ lines: [{ articleId, quantity: 1 }] })
        .expect(409);

      expect(response.body).toMatchObject(CLOSED);
      expect(await prisma.materialOrder.count()).toBe(0);
    });

    it('refuses a correction', async () => {
      const operation = await closedWithHistory();

      const response = await api()
        .post(
          `/api/v1/stores/${storeId}/accounts/${accountId}/operations/${operation.id}/corrections`,
        )
        .set('Authorization', manager.authorization)
        .set('Idempotency-Key', randomUUID())
        .send({ amount: '1000', reason: 'Montant saisi deux fois' })
        .expect(409);

      expect(response.body).toMatchObject(CLOSED);
      expect(await prisma.operation.count()).toBe(1);
    });

    it('refuses a dispute', async () => {
      const operation = await closedWithHistory();

      const response = await api()
        .post(
          `/api/v1/me/accounts/${accountId}/operations/${operation.id}/disputes`,
        )
        .set('Authorization', customer.authorization)
        .send({ message: 'Je n’ai pas versé ce montant' })
        .expect(409);

      expect(response.body).toMatchObject(CLOSED);
      expect(await prisma.dispute.count()).toBe(0);
    });

    it('still lets the customer read its history', async () => {
      await closedWithHistory();

      await api()
        .get(`/api/v1/me/accounts/${accountId}/operations`)
        .set('Authorization', customer.authorization)
        .expect(200);
      await api()
        .get(`/api/v1/stores/${storeId}/accounts/${accountId}`)
        .set('Authorization', seller.authorization)
        .expect(200);
    });

    it('leaves the closed customer out of the store’s customers report', async () => {
      const stays = await signedInStaff(app, prisma, {
        phone: '+22376123402',
        firstName: 'Awa',
      });
      const kept = await prisma.account.create({
        data: {
          number: 'C-000002',
          customerId: stays.userId,
          storeId,
          currencyCode: 'XOF',
          termsAcceptedAt: new Date(),
          openedById: seller.userId,
          goals: { create: { label: 'Non affecté', isSystem: true } },
        },
      });
      await leave().expect(200);

      const report = await api()
        .get(`/api/v1/stores/${storeId}/reports/customers`)
        .set('Authorization', manager.authorization)
        .expect(200);

      const body = report.body as {
        items: { accountId: string }[];
        total: number;
        activeCount: number;
        inactiveCount: number;
      };
      expect(body.items.map((item) => item.accountId)).toEqual([kept.id]);
      expect(body.total).toBe(1);
      expect(body.activeCount + body.inactiveCount).toBe(1);
    });
  });

  describe('joining again reopens the same account', () => {
    let code: string;

    beforeEach(async () => {
      code = newQrCode();
      await prisma.hardwareStore.update({
        where: { id: storeId },
        data: { qrCode: code },
      });
    });

    const join = (body: object = { code, termsAccepted: true }) =>
      api()
        .post('/api/v1/me/accounts/join')
        .set('Authorization', customer.authorization)
        .send(body);
    const openAtCounter = () =>
      api()
        .post(`/api/v1/stores/${storeId}/accounts`)
        .set('Authorization', seller.authorization)
        .send({
          customer: {
            phone: customer.phone,
            firstName: 'Fanta',
            lastName: 'Keita',
          },
          termsAccepted: true,
        });
    const reopenings = () =>
      prisma.activityLog.findMany({ where: { action: 'ACCOUNT_REOPENED' } });

    it('reopens it from the app: same number, history and goals, ACTIVE, logged', async () => {
      await deposit();
      await leave().expect(200);
      const before = await stored();

      const response = await join({
        code,
        termsAccepted: true,
        beneficiary: { name: 'Ali Keita' },
      }).expect(201);

      expect(response.body).toMatchObject({
        id: accountId,
        number: 'C-000001',
        status: 'ACTIVE',
        closedAt: null,
        closedBy: null,
        beneficiary: { name: 'Ali Keita', phone: null },
        goals: [{ id: goalId, label: 'Non affecté' }],
      });
      const after = await stored();
      expect(after).toMatchObject({
        status: 'ACTIVE',
        closedAt: null,
        closedById: null,
        closedReason: null,
        openedById: seller.userId,
      });
      expect(after.termsAcceptedAt.getTime()).toBeGreaterThan(
        before.termsAcceptedAt.getTime(),
      );
      expect(await prisma.account.count()).toBe(1);
      expect(await prisma.operation.count({ where: { accountId } })).toBe(1);
      const [log] = await reopenings();
      expect(log).toMatchObject({
        storeId,
        userId: customer.userId,
        newValue: { accountId, number: 'C-000001' },
      });
    });

    it('takes deposits again once reopened', async () => {
      await leave().expect(200);
      await join().expect(201);

      await api()
        .post(`/api/v1/stores/${storeId}/accounts/${accountId}/deposits`)
        .set('Authorization', seller.authorization)
        .set('Idempotency-Key', randomUUID())
        .send({ amount: '5000' })
        .expect(201);
      expect((await stored()).balance).toBe(5000n);
    });

    it('reopens it at the counter after the store closed it, reason cleared', async () => {
      await close().expect(200);

      const response = await openAtCounter().expect(201);

      expect(response.body).toMatchObject({
        id: accountId,
        number: 'C-000001',
        status: 'ACTIVE',
        closedBy: null,
        closedReason: null,
        beneficiary: null,
      });
      const [log] = await reopenings();
      expect(log).toMatchObject({ userId: seller.userId });
    });

    it('gives one reopening to two parallel joins, ACCOUNT_EXISTS to the other', async () => {
      await leave().expect(200);

      const responses = await Promise.all([join(), join()]);

      expect(responses.map((r) => r.status).sort((a, b) => a - b)).toEqual([
        201, 409,
      ]);
      expect(
        responses.find((r) => r.status === 409)?.body as unknown,
      ).toMatchObject({ error: 'ACCOUNT_EXISTS' });
      expect(await reopenings()).toHaveLength(1);
      expect(await prisma.account.count()).toBe(1);
    });

    it.each(['ACTIVE', 'SUSPENDED'] as const)(
      'still refuses a %s account, 409 ACCOUNT_EXISTS',
      async (status) => {
        await prisma.account.update({
          where: { id: accountId },
          data: { status },
        });

        const fromApp = await join().expect(409);
        expect(fromApp.body).toMatchObject({ error: 'ACCOUNT_EXISTS' });
        const atCounter = await openAtCounter().expect(409);
        expect(atCounter.body).toMatchObject({ error: 'ACCOUNT_EXISTS' });
        expect((await stored()).status).toBe(status);
        expect(await reopenings()).toHaveLength(0);
      },
    );
  });

  describe('POST /stores/:storeId/accounts/:accountId/close', () => {
    it('lets the manager close it: CLOSED, by the store, with the reason, logged', async () => {
      const response = await close().expect(200);

      expect(response.body).toMatchObject({
        id: accountId,
        status: 'CLOSED',
        closedAt: expect.any(String) as string,
        closedBy: 'STORE',
        closedReason: REASON,
      });
      expect(await stored()).toMatchObject({
        status: 'CLOSED',
        closedById: manager.userId,
        closedReason: REASON,
      });
      const [log] = await closings();
      expect(log).toMatchObject({
        storeId,
        userId: manager.userId,
        newValue: { accountId, number: 'C-000001', closedBy: 'STORE' },
      });
    });

    it('trims the reason', async () => {
      await close({ reason: `  ${REASON}  ` }).expect(200);

      expect((await stored()).closedReason).toBe(REASON);
    });

    it('tells the customer, by SMS too, without the reason', async () => {
      await close().expect(200);
      await settled();

      const rows = await prisma.notification.findMany();
      expect(rows.length).toBeGreaterThan(0);
      for (const row of rows) {
        expect(row).toMatchObject({
          userId: customer.userId,
          storeId,
          type: 'ACCOUNT_CLOSED_BY_STORE',
          title: 'Compte fermé',
        });
        expect(row.body).not.toContain(REASON);
      }
      expect(sms.messages).toEqual([
        {
          phone: customer.phone,
          text: 'La quincaillerie Quincaillerie Sira a fermé votre compte C-000001. Son historique reste consultable dans l’application. Pour y épargner de nouveau, rejoignez-la : le même compte sera rouvert.',
        },
      ]);
    });

    it('shows the customer who closed it, never why', async () => {
      await close().expect(200);

      const mine = await api()
        .get('/api/v1/me/accounts')
        .set('Authorization', customer.authorization)
        .expect(200);
      const [account] = mine.body as Record<string, unknown>[];
      expect(account).toMatchObject({ status: 'CLOSED', closedBy: 'STORE' });
      expect(account).not.toHaveProperty('closedReason');
    });

    it('shows a seller the closing and its reason', async () => {
      await close().expect(200);

      const detail = await api()
        .get(`/api/v1/stores/${storeId}/accounts/${accountId}`)
        .set('Authorization', seller.authorization)
        .expect(200);
      expect(detail.body).toMatchObject({
        status: 'CLOSED',
        closedBy: 'STORE',
        closedReason: REASON,
      });
    });

    it('is for managers only: a seller gets 403', async () => {
      const response = await close({ reason: REASON }, seller).expect(403);

      expect(response.body).toMatchObject({ error: 'STORE_ROLE_REQUIRED' });
      expect((await stored()).status).toBe('ACTIVE');
    });

    it('answers 404 to an account of another store', async () => {
      const other = await signedInStaff(app, prisma, {
        phone: '+22376000020',
        store: { id: otherStoreId, role: 'MANAGER' },
      });

      await close({ reason: REASON }, other, accountId, otherStoreId).expect(
        404,
      );
      expect((await stored()).status).toBe('ACTIVE');
    });

    it.each([[{}], [{ reason: 'ok' }], [{ reason: 'x'.repeat(501) }]])(
      'refuses an invalid reason %j with 400',
      async (body) => {
        const response = await close(body).expect(400);

        expect(response.body).toMatchObject({
          details: [{ field: 'reason' }],
        });
        expect((await stored()).status).toBe('ACTIVE');
      },
    );

    it('follows the same rules as leaving: money refuses it', async () => {
      await prisma.account.update({
        where: { id: accountId },
        data: { balance: 500n },
      });

      const response = await close().expect(409);

      expect(response.body).toMatchObject({ error: 'ACCOUNT_NOT_EMPTY' });
      await settled();
      expect(await prisma.notification.count()).toBe(0);
    });

    it('refuses an account the customer already left, 409 ACCOUNT_CLOSED', async () => {
      await leave().expect(200);

      const response = await close().expect(409);

      expect(response.body).toMatchObject({ error: 'ACCOUNT_CLOSED' });
      expect((await stored()).closedById).toBe(customer.userId);
    });
  });
});
