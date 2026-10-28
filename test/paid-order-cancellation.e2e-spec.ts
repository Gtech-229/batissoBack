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

describe('Cancelling a paid order (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  const sms = new CapturingSmsSender();
  const push = new CapturingPushSender();
  let storeId: string;
  let otherStoreId: string;
  let manager: MobileStaff;
  let seller: MobileStaff;
  let outsider: MobileStaff;
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
    otherStoreId = (await createStoreRecord(prisma, { status: 'VERIFIED' })).id;
    manager = await signedInStaff(app, prisma, {
      phone: '+22376000000',
      firstName: 'Awa',
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
  const deposit = (amount: string, goalId?: string) =>
    api()
      .post(`/api/v1/stores/${storeId}/accounts/${accountId}/deposits`)
      .set('Authorization', seller.authorization)
      .set('Idempotency-Key', randomUUID())
      .send({ amount, goalId })
      .expect(201);
  const createGoal = async (label = 'Ciment', targetAmount = '500000') =>
    (
      await api()
        .post(`/api/v1/me/accounts/${accountId}/goals`)
        .set('Authorization', customer.authorization)
        .send({ label, targetAmount })
        .expect(201)
    ).body.id as string;
  /** An order of `bags` × 5 000, prepared by the seller, paid from `goalId`. */
  const prepare = async (bags = 4, goalId?: string) =>
    (
      await api()
        .post(`/api/v1/stores/${storeId}/accounts/${accountId}/orders`)
        .set('Authorization', seller.authorization)
        .send({ goalId, lines: [{ articleId: cementId, quantity: bags }] })
        .expect(201)
    ).body as { id: string; reference: string };
  /** An order the customer confirmed with their PIN: debited, to cancel. */
  const confirmed = async (bags = 4, goalId?: string) => {
    const order = await prepare(bags, goalId);
    const response = await api()
      .post(`/api/v1/me/accounts/${accountId}/orders/${order.id}/confirm`)
      .set('Authorization', customer.authorization)
      .set('Idempotency-Key', randomUUID())
      .send({ pin: TEST_PIN })
      .expect(201);
    return { ...order, debitReference: response.body.debitReference as string };
  };
  const cancel = (
    orderId: string,
    body: Record<string, unknown> = { reason: 'Rupture de stock' },
    options: { as?: MobileStaff; key?: string; store?: string } = {},
  ) => {
    const call = api()
      .post(
        `/api/v1/stores/${options.store ?? storeId}/orders/${orderId}/cancel-after-debit`,
      )
      .set('Authorization', (options.as ?? manager).authorization);
    if (options.key !== '') {
      call.set('Idempotency-Key', options.key ?? randomUUID());
    }
    return call.send(body);
  };
  const balances = async () => {
    const goals = await prisma.goal.findMany({ where: { accountId } });
    return {
      account: (
        await prisma.account.findUniqueOrThrow({ where: { id: accountId } })
      ).balance,
      goals: Object.fromEntries(goals.map((g) => [g.label, g.balance])),
    };
  };
  /** The invariant: the goals of the account always sum to its balance. */
  const expectGoalsSumToBalance = async () => {
    const { account, goals } = await balances();
    expect(Object.values(goals).reduce((s, b) => s + b, 0n)).toBe(account);
  };
  const counts = async () => ({
    operations: await prisma.operation.count(),
    movements: await prisma.goalMovement.count(),
    notifications: await prisma.notification.count(),
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
  const rowsOf = (type: string) =>
    prisma.notification.findMany({
      where: { type: type as never },
      orderBy: { channel: 'asc' },
    });
  const setStoreStatus = (status: 'VERIFIED' | 'SUSPENDED' | 'CLOSED') =>
    prisma.hardwareStore.update({ where: { id: storeId }, data: { status } });

  describe('POST /stores/:storeId/orders/:orderId/cancel-after-debit', () => {
    it('cancels a paid order and re-credits its goal, linked to the debit', async () => {
      const goalId = await createGoal();
      await deposit('50000', goalId);
      await deposit('10000');
      const before = await balances();
      const order = await confirmed(4, goalId);

      const response = await cancel(order.id, {
        reason: '  Rupture de stock : livraison impossible ',
      }).expect(201);

      expect(response.body).toMatchObject({
        id: order.id,
        status: 'CANCELLED_AFTER_DEBIT',
        cancellationReason: 'Rupture de stock : livraison impossible',
        cancelledAt: expect.any(String),
        cancelledBy: { userId: manager.userId, firstName: 'Awa' },
        debitReference: order.debitReference,
        recreditReference: expect.stringMatching(/^R-\d{5,}$/),
      });
      // Back to where the customer stood before the order.
      expect(await balances()).toEqual(before);
      await expectGoalsSumToBalance();
      const recredit = await prisma.operation.findUniqueOrThrow({
        where: { reference: response.body.recreditReference as string },
        include: { correctedOperation: true },
      });
      expect(recredit).toMatchObject({
        type: 'CORRECTION',
        direction: 'CREDIT',
        amount: 20000n,
        goalId,
        authorId: manager.userId,
        reason: 'Rupture de stock : livraison impossible',
        correctedOperation: {
          reference: order.debitReference,
          type: 'MATERIAL_DEBIT',
          amount: 20000n,
        },
      });
    });

    it('gives Unassigned back the shortfall it had covered', async () => {
      const goalId = await createGoal();
      await deposit('10000', goalId);
      await deposit('30000');
      const before = await balances();
      // 20 000 from a goal holding 10 000: Unassigned paid 10 000 of it.
      const order = await confirmed(4, goalId);
      expect((await balances()).goals).toMatchObject({
        Ciment: 0n,
        'Non affecté': 20000n,
      });

      await cancel(order.id).expect(201);

      expect(await balances()).toEqual(before);
      const movements = await prisma.goalMovement.findMany({
        where: { reason: 'ORDER_CANCELLATION' },
      });
      expect(movements).toEqual([
        expect.objectContaining({
          sourceGoalId: goalId,
          amount: 10000n,
          orderId: order.id,
          authorId: manager.userId,
        }),
      ]);
      await expectGoalsSumToBalance();
    });

    it('re-credits Unassigned when the order’s goal was closed since', async () => {
      const goalId = await createGoal();
      await deposit('20000', goalId);
      const order = await confirmed(4, goalId);
      await api()
        .post(`/api/v1/me/accounts/${accountId}/goals/${goalId}/close`)
        .set('Authorization', customer.authorization)
        .expect(200);

      await cancel(order.id).expect(201);

      expect(await balances()).toEqual({
        account: 20000n,
        goals: { Ciment: 0n, 'Non affecté': 20000n },
      });
      expect(
        await prisma.goalMovement.count({
          where: { reason: 'ORDER_CANCELLATION' },
        }),
      ).toBe(0);
      await expectGoalsSumToBalance();
    });

    it('shows the customer the cancellation and the re-credit, without staff identity', async () => {
      await deposit('50000');
      const order = await confirmed();
      const cancelled = await cancel(order.id).expect(201);

      const mine = await api()
        .get(`/api/v1/me/accounts/${accountId}/orders/${order.id}`)
        .set('Authorization', customer.authorization)
        .expect(200);
      expect(mine.body).toMatchObject({
        status: 'CANCELLED_AFTER_DEBIT',
        cancellationReason: 'Rupture de stock',
        recreditReference: cancelled.body.recreditReference,
      });
      expect(mine.body).not.toHaveProperty('cancelledBy');
      expect(JSON.stringify(mine.body)).not.toContain(manager.userId);

      // Both histories show the re-credit, linked to the debit (F-14).
      const histories = await Promise.all([
        api()
          .get(`/api/v1/me/accounts/${accountId}/operations`)
          .set('Authorization', customer.authorization)
          .expect(200),
        api()
          .get(`/api/v1/stores/${storeId}/accounts/${accountId}/operations`)
          .set('Authorization', manager.authorization)
          .expect(200),
      ]);
      for (const history of histories) {
        expect(history.body.items[0]).toMatchObject({
          reference: cancelled.body.recreditReference,
          type: 'CORRECTION',
          direction: 'CREDIT',
          reason: 'Rupture de stock',
          correctedReference: order.debitReference,
        });
      }
    });

    it('refuses a re-credit’s key on the corrections route with 409 IDEMPOTENCY_KEY_REUSED', async () => {
      await deposit('50000');
      const order = await confirmed();
      const key = randomUUID();
      await cancel(order.id, undefined, { key }).expect(201);
      const debit = await prisma.operation.findUniqueOrThrow({
        where: { reference: order.debitReference },
      });
      const before = await counts();

      // Same key, the debit the re-credit corrects, and the same amount (F-13).
      await api()
        .post(
          `/api/v1/stores/${storeId}/accounts/${accountId}/operations/${debit.id}/corrections`,
        )
        .set('Authorization', manager.authorization)
        .set('Idempotency-Key', key)
        .send({ amount: '20000', reason: 'Rupture de stock' })
        .expect(409)
        .expect((r) => expect(r.body.error).toBe('IDEMPOTENCY_KEY_REUSED'));
      expect(await counts()).toEqual(before);
    });

    it('refuses an order that is not confirmed and undelivered with 409 ORDER_STATUS', async () => {
      await deposit('100000');
      const waiting = await prepare();
      const delivered = await confirmed();
      await api()
        .post(`/api/v1/stores/${storeId}/orders/${delivered.id}/deliver`)
        .set('Authorization', seller.authorization)
        .expect(200);
      const cancelledBefore = await prepare();
      await api()
        .post(`/api/v1/stores/${storeId}/orders/${cancelledBefore.id}/cancel`)
        .set('Authorization', seller.authorization)
        .send({})
        .expect(200);
      const twice = await confirmed();
      await cancel(twice.id).expect(201);
      const before = await counts();

      for (const [orderId, label] of [
        [waiting.id, 'en attente du client'],
        [delivered.id, 'livré'],
        [cancelledBefore.id, 'annulé'],
        [twice.id, 'annulé après débit'],
      ]) {
        await cancel(orderId)
          .expect(409)
          .expect((r) =>
            expect(r.body).toMatchObject({
              error: 'ORDER_STATUS',
              message: `Ce bon est ${label} : cette action n’est pas possible`,
            }),
          );
      }
      expect(await counts()).toEqual(before);
    });

    it('cancels and re-credits in a closed store, and in a suspended one', async () => {
      await deposit('100000');
      for (const status of ['CLOSED', 'SUSPENDED'] as const) {
        const order = await confirmed();
        await setStoreStatus(status);

        await cancel(order.id)
          .expect(201)
          .expect((r) => expect(r.body.status).toBe('CANCELLED_AFTER_DEBIT'));
        await setStoreStatus('VERIFIED');
      }
      expect((await balances()).account).toBe(100000n);
    });

    it('is for the manager only: a seller gets 403 STORE_ROLE_REQUIRED', async () => {
      await deposit('50000');
      const order = await confirmed();
      const before = await counts();

      await cancel(order.id, undefined, { as: seller })
        .expect(403)
        .expect((r) => expect(r.body.error).toBe('STORE_ROLE_REQUIRED'));
      expect(await counts()).toEqual(before);
    });

    it('answers 404 for another store’s order, a non-member, and an unknown order', async () => {
      await deposit('50000');
      const order = await confirmed();
      const before = await counts();

      await cancel(order.id, undefined, { as: outsider, store: otherStoreId })
        .expect(404)
        .expect((r) => expect(r.body.message).toBe('Bon introuvable'));
      for (const as of [outsider, customer]) {
        await cancel(order.id, undefined, { as })
          .expect(404)
          .expect((r) =>
            expect(r.body.message).toBe('Quincaillerie introuvable'),
          );
      }
      await cancel(randomUUID())
        .expect(404)
        .expect((r) => expect(r.body.message).toBe('Bon introuvable'));
      expect(await counts()).toEqual(before);
    });

    it.each([
      ['no reason', {}],
      ['a blank reason', { reason: '   ' }],
      ['a reason over 500 characters', { reason: 'x'.repeat(501) }],
    ])('refuses %s with a French 400', async (_, body) => {
      await deposit('50000');
      const order = await confirmed();
      const before = await counts();

      await cancel(order.id, body)
        .expect(400)
        .expect((r) =>
          expect(r.body.details).toContainEqual(
            expect.objectContaining({ field: 'reason' }),
          ),
        );
      expect(await counts()).toEqual(before);
    });

    it('refuses a malformed id, and a missing or invalid Idempotency-Key, with 400', async () => {
      await deposit('50000');
      const order = await confirmed();
      const before = await counts();

      await cancel('b-1').expect(400);
      for (const key of ['', 'not-a-uuid']) {
        await cancel(order.id, undefined, { key })
          .expect(400)
          .expect((r) =>
            expect(r.body.details).toContainEqual(
              expect.objectContaining({ field: 'Idempotency-Key' }),
            ),
          );
      }
      expect(await counts()).toEqual(before);
    });

    describe('idempotency', () => {
      it('answers a same-key retry with 200 and the same order, writing once', async () => {
        await deposit('50000');
        const order = await confirmed();
        const key = randomUUID();

        const first = await cancel(order.id, undefined, { key }).expect(201);
        const again = await cancel(order.id, undefined, { key }).expect(200);

        expect(again.body).toEqual(first.body);
        expect(
          await prisma.operation.count({ where: { type: 'CORRECTION' } }),
        ).toBe(1);
        expect((await balances()).account).toBe(50000n);
      });

      it('refuses a key reused for another order with 409 IDEMPOTENCY_KEY_REUSED', async () => {
        await deposit('50000');
        const first = await confirmed();
        const second = await confirmed();
        const key = randomUUID();
        await cancel(first.id, undefined, { key }).expect(201);
        const before = await counts();

        await cancel(second.id, undefined, { key })
          .expect(409)
          .expect((r) => expect(r.body.error).toBe('IDEMPOTENCY_KEY_REUSED'));
        expect(await counts()).toEqual(before);
      });

      it('writes once when the same key is sent in parallel', async () => {
        await deposit('50000');
        const order = await confirmed();
        const key = randomUUID();

        const statuses = (
          await Promise.all(
            [1, 2, 3].map(() => cancel(order.id, undefined, { key })),
          )
        )
          .map((r) => r.status)
          .sort((a, b) => a - b);

        expect(statuses).toEqual([200, 200, 201]);
        expect(
          await prisma.operation.count({ where: { type: 'CORRECTION' } }),
        ).toBe(1);
        expect((await balances()).account).toBe(50000n);
      });
    });

    describe('concurrency', () => {
      it('re-credits once out of two parallel cancellations', async () => {
        await deposit('50000');
        const order = await confirmed();

        const responses = await Promise.all([
          cancel(order.id),
          cancel(order.id),
        ]);

        expect(
          responses
            .map((r) => [r.status, r.status === 409 ? r.body.error : null])
            .sort((a, b) => Number(a[0]) - Number(b[0])),
        ).toEqual([
          [201, null],
          [409, 'ORDER_STATUS'],
        ]);
        expect(
          await prisma.operation.count({ where: { type: 'CORRECTION' } }),
        ).toBe(1);
        expect((await balances()).account).toBe(50000n);
        await expectGoalsSumToBalance();
      });

      it('lets only one of a cancellation and a delivery win, with the money right', async () => {
        await deposit('50000');
        const order = await confirmed();

        const [cancelled, delivered] = await Promise.all([
          cancel(order.id),
          api()
            .post(`/api/v1/stores/${storeId}/orders/${order.id}/deliver`)
            .set('Authorization', seller.authorization),
        ]);

        const stored = await prisma.materialOrder.findUniqueOrThrow({
          where: { id: order.id },
        });
        if (cancelled.status === 201) {
          expect(delivered.status).toBe(409);
          expect(stored.status).toBe('CANCELLED_AFTER_DEBIT');
          expect((await balances()).account).toBe(50000n);
        } else {
          expect([cancelled.status, delivered.status]).toEqual([409, 200]);
          expect(stored.status).toBe('DELIVERED');
          expect((await balances()).account).toBe(30000n);
          expect(
            await prisma.operation.count({ where: { type: 'CORRECTION' } }),
          ).toBe(0);
        }
        await expectGoalsSumToBalance();
      });
    });
  });

  describe('ORDER_CANCELLED_AFTER_DEBIT', () => {
    it('tells the customer in the app, by push, and by SMS', async () => {
      await deposit('300000');
      const order = await confirmed();
      await settled();
      sms.clear();
      push.clear();

      const cancelled = await cancel(order.id).expect(201);
      await settled();

      const rows = await rowsOf('ORDER_CANCELLED_AFTER_DEBIT');
      expect(rows.map((row) => [row.channel, row.userId])).toEqual([
        ['APP', customer.userId],
        ['PUSH', customer.userId],
        ['SMS', customer.userId],
      ]);
      const recredit = await prisma.operation.findUniqueOrThrow({
        where: { reference: cancelled.body.recreditReference as string },
      });
      const body = `Le bon ${order.reference} chez Quincaillerie du Carrefour est annulé : « Rupture de stock ». 20 000 XOF remis sur votre compte ${accountNumber}. Nouveau solde : 300 000 XOF. Réf. ${recredit.reference}.`;
      expect(
        rows.every(
          (row) =>
            row.title === 'Bon annulé et remboursé' &&
            row.body === body &&
            row.operationId === recredit.id &&
            row.storeId === storeId,
        ),
      ).toBe(true);
      expect(sms.messages).toEqual([{ phone: customer.phone, text: body }]);
      expect(push.messages).toEqual([
        expect.objectContaining({ title: 'Bon annulé et remboursé' }),
      ]);
    });

    it('tells nothing for a replay or a refusal', async () => {
      await deposit('300000');
      const order = await confirmed();
      const key = randomUUID();
      await cancel(order.id, undefined, { key }).expect(201);
      await settled();

      await cancel(order.id, undefined, { key }).expect(200);
      await cancel(order.id).expect(409);
      await cancel(order.id, undefined, { as: seller }).expect(403);
      await settled();

      expect(await rowsOf('ORDER_CANCELLED_AFTER_DEBIT')).toHaveLength(3);
    });

    it('records GOAL_REACHED when the money back takes the goal over its target again', async () => {
      const goalId = await createGoal('Ciment', '20000');
      await deposit('20000', goalId);
      const order = await confirmed(4, goalId);
      await settled();
      const reachedBefore = (await rowsOf('GOAL_REACHED')).length;

      const cancelled = await cancel(order.id).expect(201);
      await settled();

      const reached = await rowsOf('GOAL_REACHED');
      expect(reached).toHaveLength(reachedBefore + 2);
      const recredit = await prisma.operation.findUniqueOrThrow({
        where: { reference: cancelled.body.recreditReference as string },
      });
      expect(
        reached.filter((row) => row.operationId === recredit.id),
      ).toHaveLength(2);
      expect(
        await prisma.goal.findUniqueOrThrow({ where: { id: goalId } }),
      ).toMatchObject({ balance: 20000n, status: 'REACHED' });
    });
  });
});
