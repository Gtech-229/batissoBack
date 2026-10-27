import type { INestApplication } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { createTestApp } from './utils/app.js';
import { createMali, createStoreRecord } from './utils/countries.js';
import { resetDatabase } from './utils/reset-database.js';
import { signedInStaff, type MobileStaff } from './utils/staff.js';
import { TEST_PIN } from './utils/users.js';

describe('Confirming an order with the PIN, and the debit (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let storeId: string;
  let manager: MobileStaff;
  let seller: MobileStaff;
  let customer: MobileStaff;
  let other: MobileStaff;
  let accountId: string;
  let otherAccountId: string;
  let unassignedId: string;
  let cementGoalId: string;
  let cementId: string;

  beforeAll(async () => {
    app = await createTestApp();
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
    accountId = await openAccount(customer.phone);
    otherAccountId = await openAccount(other.phone);
    unassignedId = (
      await prisma.goal.findFirstOrThrow({
        where: { accountId, isSystem: true },
      })
    ).id;
    cementGoalId = (
      await api()
        .post(`/api/v1/me/accounts/${accountId}/goals`)
        .set('Authorization', customer.authorization)
        .send({ label: 'Ciment', targetAmount: '40000' })
        .expect(201)
    ).body.id as string;
    // Unassigned 300 000, Ciment 30 000: the account holds 330 000.
    await deposit(accountId, '300000');
    await deposit(accountId, '30000', cementGoalId);
    await deposit(otherAccountId, '100000');
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
  const deposit = (account: string, amount: string, goalId?: string) =>
    api()
      .post(`/api/v1/stores/${storeId}/accounts/${account}/deposits`)
      .set('Authorization', seller.authorization)
      .set('Idempotency-Key', randomUUID())
      .send({ amount, goalId })
      .expect(201);
  /** 5 000 a bag; above 40 bags (200 000) a seller's order waits for the manager. */
  const prepare = async (
    bags: number,
    options: { goalId?: string; as?: MobileStaff; account?: string } = {},
  ) =>
    (
      await api()
        .post(
          `/api/v1/stores/${storeId}/accounts/${options.account ?? accountId}/orders`,
        )
        .set('Authorization', (options.as ?? seller).authorization)
        .send({
          goalId: options.goalId,
          lines: [{ articleId: cementId, quantity: bags }],
        })
        .expect(201)
    ).body as { id: string; reference: string };
  const confirm = (
    orderId: string,
    options: {
      pin?: string;
      key?: string | null;
      as?: MobileStaff;
      account?: string;
    } = {},
  ) => {
    const call = api()
      .post(
        `/api/v1/me/accounts/${options.account ?? accountId}/orders/${orderId}/confirm`,
      )
      .set('Authorization', (options.as ?? customer).authorization);
    if (options.key !== null) {
      call.set('Idempotency-Key', options.key ?? randomUUID());
    }
    return call.send({ pin: options.pin ?? TEST_PIN });
  };
  const balances = async () => {
    const account = await prisma.account.findUniqueOrThrow({
      where: { id: accountId },
      include: { goals: true },
    });
    const goal = (id: string) =>
      account.goals.find((g) => g.id === id)!.balance;
    // The invariant: the goals always sum to the account balance.
    expect(account.goals.reduce((sum, g) => sum + g.balance, 0n)).toBe(
      account.balance,
    );
    return {
      account: account.balance,
      unassigned: goal(unassignedId),
      cement: goal(cementGoalId),
    };
  };
  const debits = () =>
    prisma.operation.findMany({ where: { type: 'MATERIAL_DEBIT' } });
  const statusOf = async (orderId: string) =>
    (await prisma.materialOrder.findUniqueOrThrow({ where: { id: orderId } }))
      .status;

  describe('the debit', () => {
    it('pays from the goal alone when it holds enough', async () => {
      const order = await prepare(4, { goalId: cementGoalId });

      const response = await confirm(order.id).expect(201);

      expect(response.body).toMatchObject({
        id: order.id,
        status: 'CONFIRMED',
        confirmedVia: 'PIN',
        confirmedAt: expect.any(String),
        debitReference: expect.stringMatching(/^A-\d{5,}$/),
      });
      const [operation] = await debits();
      expect(operation).toMatchObject({
        reference: response.body.debitReference,
        goalId: cementGoalId,
        amount: 20000n,
        direction: 'DEBIT',
        status: 'CONFIRMED',
        channel: 'CASH',
        balanceBefore: 330000n,
        balanceAfter: 310000n,
        authorId: seller.userId,
        validatedById: null,
        device: customer.deviceId,
        customerConfirmedAt: expect.any(Date),
      });
      expect(await balances()).toEqual({
        account: 310000n,
        unassigned: 300000n,
        cement: 10000n,
      });
      expect(await prisma.goalMovement.count()).toBe(0);
    });

    it('tops the goal up from Unassigned for the shortfall, then debits once', async () => {
      // 10 bags = 50 000; the Ciment goal holds 30 000.
      const order = await prepare(10, { goalId: cementGoalId });

      await confirm(order.id).expect(201);

      expect(await prisma.goalMovement.findMany()).toEqual([
        expect.objectContaining({
          sourceGoalId: unassignedId,
          targetGoalId: cementGoalId,
          amount: 20000n,
          reason: 'ORDER_SHORTFALL',
          orderId: order.id,
          authorId: customer.userId,
          idempotencyKey: null,
        }),
      ]);
      expect(await debits()).toEqual([
        expect.objectContaining({ goalId: cementGoalId, amount: 50000n }),
      ]);
      expect(await balances()).toEqual({
        account: 280000n,
        unassigned: 280000n,
        cement: 0n,
      });
    });

    it('pays from Unassigned alone when it is the order’s goal', async () => {
      const order = await prepare(10);

      await confirm(order.id).expect(201);

      expect(await debits()).toEqual([
        expect.objectContaining({ goalId: unassignedId, amount: 50000n }),
      ]);
      expect(await balances()).toEqual({
        account: 280000n,
        unassigned: 250000n,
        cement: 30000n,
      });
    });

    it('returns a reached goal to IN_PROGRESS when the debit takes it below its target', async () => {
      // Ciment reaches its 40 000 target, then pays a 20 000 order.
      await deposit(accountId, '10000', cementGoalId);
      expect(
        (await prisma.goal.findUniqueOrThrow({ where: { id: cementGoalId } }))
          .status,
      ).toBe('REACHED');
      const order = await prepare(4, { goalId: cementGoalId });

      await confirm(order.id).expect(201);

      expect(
        await prisma.goal.findUniqueOrThrow({ where: { id: cementGoalId } }),
      ).toMatchObject({ status: 'IN_PROGRESS', reachedAt: null });
    });

    it('records the manager who validated the order', async () => {
      const order = await prepare(50, { as: manager });

      await confirm(order.id).expect(201);

      expect((await debits())[0].validatedById).toBe(manager.userId);
    });
  });

  describe('refusals that write nothing', () => {
    it('refuses a wrong PIN with 400 INVALID_PIN and counts it', async () => {
      const order = await prepare(4);

      const response = await confirm(order.id, { pin: '111222' }).expect(400);

      expect(response.body).toMatchObject({
        error: 'INVALID_PIN',
        message: 'Code PIN incorrect',
      });
      expect(
        (
          await prisma.user.findUniqueOrThrow({
            where: { id: customer.userId },
          })
        ).failedPinAttempts,
      ).toBe(1);
      expect(await statusOf(order.id)).toBe('AWAITING_CUSTOMER');
      expect(await debits()).toHaveLength(0);
    });

    it('locks the customer after maxPinAttempts wrong PINs, even with the right one', async () => {
      await prisma.systemSettings.upsert({
        where: { id: 1 },
        create: { maxLoginAttempts: 5, maxAdminSessions: 3, maxPinAttempts: 2 },
        update: { maxPinAttempts: 2 },
      });
      const order = await prepare(4);
      await confirm(order.id, { pin: '111222' }).expect(400);
      await confirm(order.id, { pin: '111222' }).expect(400);

      await confirm(order.id)
        .expect(403)
        .expect((r) => expect(r.body.error).toBe('PIN_LOCKED'));
      expect(await debits()).toHaveLength(0);
    });

    it('re-checks the balance: money moved away since preparation gives 409 INSUFFICIENT_BALANCE', async () => {
      // 250 000 from Unassigned (the manager's order needs no validation).
      const order = await prepare(50, { as: manager });
      await api()
        .post(`/api/v1/me/accounts/${accountId}/goal-movements`)
        .set('Authorization', customer.authorization)
        .set('Idempotency-Key', randomUUID())
        .send({
          sourceGoalId: unassignedId,
          targetGoalId: cementGoalId,
          amount: '100000',
        })
        .expect(201);

      const response = await confirm(order.id).expect(409);

      expect(response.body).toMatchObject({
        error: 'INSUFFICIENT_BALANCE',
        message:
          'Ce bon de 250000 XOF dépasse ce qui est disponible : 200000 XOF (objectif choisi et « Non affecté »)',
      });
      expect(await statusOf(order.id)).toBe('AWAITING_CUSTOMER');
      expect(await debits()).toHaveLength(0);
      await balances();
    });

    it('refuses an order whose goal was closed with 409 GOAL_CLOSED', async () => {
      const order = await prepare(4, { goalId: cementGoalId });
      await api()
        .post(`/api/v1/me/accounts/${accountId}/goals/${cementGoalId}/close`)
        .set('Authorization', customer.authorization)
        .expect(200);

      await confirm(order.id)
        .expect(409)
        .expect((r) => expect(r.body.error).toBe('GOAL_CLOSED'));
      expect(await debits()).toHaveLength(0);
    });

    it.each([
      ['awaiting validation', 'en attente de validation'],
      ['cancelled', 'annulé'],
      ['already confirmed', 'confirmé par le client'],
    ])('refuses an order %s with 409 ORDER_STATUS', async (state, label) => {
      const order = await prepare(state === 'awaiting validation' ? 50 : 4);
      if (state === 'cancelled') {
        await api()
          .post(`/api/v1/stores/${storeId}/orders/${order.id}/cancel`)
          .set('Authorization', seller.authorization)
          .expect(200);
      }
      if (state === 'already confirmed') {
        await confirm(order.id).expect(201);
      }

      await confirm(order.id)
        .expect(409)
        .expect((r) =>
          expect(r.body.message).toBe(
            `Ce bon est ${label} : cette action n’est pas possible`,
          ),
        );
      expect(await debits()).toHaveLength(
        state === 'already confirmed' ? 1 : 0,
      );
    });

    it('refuses a closed store with 409 STORE_CLOSED, and debits in a suspended one', async () => {
      const first = await prepare(4);
      const second = await prepare(4);
      await prisma.hardwareStore.update({
        where: { id: storeId },
        data: { status: 'SUSPENDED' },
      });
      await confirm(first.id).expect(201);

      await prisma.hardwareStore.update({
        where: { id: storeId },
        data: { status: 'CLOSED' },
      });
      await confirm(second.id)
        .expect(409)
        .expect((r) => expect(r.body.error).toBe('STORE_CLOSED'));
      expect(await debits()).toHaveLength(1);
    });

    it('answers 404 to another customer, to staff, and for another account’s order', async () => {
      const order = await prepare(4);
      const theirs = await prepare(4, { account: otherAccountId });

      for (const as of [other, seller]) {
        await confirm(order.id, { as })
          .expect(404)
          .expect((r) => expect(r.body.message).toBe('Compte introuvable'));
      }
      await confirm(theirs.id)
        .expect(404)
        .expect((r) => expect(r.body.message).toBe('Bon introuvable'));
      expect(await debits()).toHaveLength(0);
    });

    it('refuses a malformed PIN and a missing key with a French 400', async () => {
      const order = await prepare(4);

      await confirm(order.id, { pin: '12ab' })
        .expect(400)
        .expect((r) =>
          expect(r.body.details).toContainEqual(
            expect.objectContaining({ field: 'pin' }),
          ),
        );
      await confirm(order.id, { key: null })
        .expect(400)
        .expect((r) =>
          expect(r.body.details).toContainEqual(
            expect.objectContaining({ field: 'Idempotency-Key' }),
          ),
        );
      expect(await debits()).toHaveLength(0);
    });
  });

  describe('exactly once', () => {
    it('answers a retry with the same key with 200 and debits nothing again', async () => {
      const order = await prepare(4);
      const key = randomUUID();
      const first = await confirm(order.id, { key }).expect(201);

      const retry = await confirm(order.id, { key }).expect(200);

      expect(retry.body).toEqual(first.body);
      expect(await debits()).toHaveLength(1);
      expect((await balances()).account).toBe(310000n);
    });

    it('refuses the same key for another order with 409 IDEMPOTENCY_KEY_REUSED', async () => {
      const first = await prepare(4);
      const second = await prepare(4);
      const key = randomUUID();
      await confirm(first.id, { key }).expect(201);

      await confirm(second.id, { key })
        .expect(409)
        .expect((r) => expect(r.body.error).toBe('IDEMPOTENCY_KEY_REUSED'));
      expect(await statusOf(second.id)).toBe('AWAITING_CUSTOMER');
    });

    it('debits once when two confirmations with different keys run in parallel', async () => {
      const order = await prepare(4);

      const responses = await Promise.all([
        confirm(order.id),
        confirm(order.id),
      ]);

      expect(responses.map((r) => r.status).sort((a, b) => a - b)).toEqual([
        201, 409,
      ]);
      expect(await debits()).toHaveLength(1);
      expect((await balances()).account).toBe(310000n);
    });

    it('debits once when the same key is sent twice in parallel', async () => {
      const order = await prepare(4);
      const key = randomUUID();

      const responses = await Promise.all([
        confirm(order.id, { key }),
        confirm(order.id, { key }),
      ]);

      expect(responses.map((r) => r.status).sort((a, b) => a - b)).toEqual([
        200, 201,
      ]);
      expect(await debits()).toHaveLength(1);
    });

    it('lets exactly one of a parallel confirmation and cancellation win', async () => {
      const order = await prepare(4);

      const [confirmation, cancellation] = await Promise.all([
        confirm(order.id),
        api()
          .post(`/api/v1/stores/${storeId}/orders/${order.id}/cancel`)
          .set('Authorization', seller.authorization),
      ]);

      expect(
        [confirmation.status, cancellation.status].sort((a, b) => a - b),
      ).toEqual(confirmation.status === 201 ? [201, 409] : [200, 409]);
      const status = await statusOf(order.id);
      expect(status).toBe(
        confirmation.status === 201 ? 'CONFIRMED' : 'CANCELLED',
      );
      expect(await debits()).toHaveLength(status === 'CONFIRMED' ? 1 : 0);
      await balances();
    });
  });
});
