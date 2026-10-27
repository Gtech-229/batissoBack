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

describe('Manager corrections of deposits (e2e)', () => {
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
  let otherAccountId: string;

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
    const opened = await openAccount(customer.phone);
    accountId = opened.id;
    accountNumber = opened.number;
    otherAccountId = (await openAccount('+22376998877')).id;
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
    ).body as { id: string; number: string };
  const deposit = async (
    amount: string,
    options: { goalId?: string; account?: string } = {},
  ) =>
    (
      await api()
        .post(
          `/api/v1/stores/${storeId}/accounts/${options.account ?? accountId}/deposits`,
        )
        .set('Authorization', seller.authorization)
        .set('Idempotency-Key', randomUUID())
        .send({ amount, goalId: options.goalId })
        .expect(201)
    ).body as { id: string; reference: string };
  const correct = (
    operationId: string,
    body: Record<string, unknown> = { amount: '1000', reason: 'Erreur' },
    options: {
      as?: MobileStaff;
      key?: string;
      store?: string;
      account?: string;
    } = {},
  ) => {
    const call = api()
      .post(
        `/api/v1/stores/${options.store ?? storeId}/accounts/${options.account ?? accountId}/operations/${operationId}/corrections`,
      )
      .set('Authorization', (options.as ?? manager).authorization);
    if (options.key !== '') {
      call.set('Idempotency-Key', options.key ?? randomUUID());
    }
    return call.send(body);
  };
  const createGoal = async (label: string) =>
    (
      await api()
        .post(`/api/v1/me/accounts/${accountId}/goals`)
        .set('Authorization', customer.authorization)
        .send({ label, targetAmount: '100000' })
        .expect(201)
    ).body.id as string;
  const goalsOf = (id = accountId) =>
    prisma.goal.findMany({ where: { accountId: id } });
  const balanceOf = async (id = accountId) =>
    (await prisma.account.findUniqueOrThrow({ where: { id } })).balance;
  const goalBalance = async (goalId: string) =>
    (await prisma.goal.findUniqueOrThrow({ where: { id: goalId } })).balance;
  const unassignedId = async () =>
    (
      await prisma.goal.findFirstOrThrow({
        where: { accountId, isSystem: true },
      })
    ).id;
  /** The invariant: the goals of the account always sum to its balance. */
  const expectGoalsSumToBalance = async (id = accountId) => {
    const sum = (await goalsOf(id)).reduce((s, g) => s + g.balance, 0n);
    expect(sum).toBe(await balanceOf(id));
  };
  const counts = async () => ({
    operations: await prisma.operation.count(),
    movements: await prisma.goalMovement.count(),
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

  describe('POST .../operations/:operationId/corrections', () => {
    it('takes part of a deposit back, then the rest, linked to it with the reason', async () => {
      const recorded = await deposit('5000');

      const first = await correct(recorded.id, {
        amount: '4500',
        reason: '  Erreur de saisie : 500 F versés, pas 5 000 F ',
      }).expect(201);

      expect(first.body).toMatchObject({
        reference: expect.stringMatching(/^R-\d{5,}$/),
        type: 'CORRECTION',
        direction: 'DEBIT',
        status: 'CONFIRMED',
        channel: 'CASH',
        amount: '4500',
        balanceBefore: '5000',
        balanceAfter: '500',
        reason: 'Erreur de saisie : 500 F versés, pas 5 000 F',
        correctedReference: recorded.reference,
        goal: { label: 'Non affecté' },
        recordedBy: { firstName: 'Awa' },
      });
      await expectGoalsSumToBalance();

      const rest = await correct(recorded.id, {
        amount: '500',
        reason: 'Le reste',
      }).expect(201);
      expect(rest.body).toMatchObject({ balanceAfter: '0' });
      expect(await balanceOf()).toBe(0n);
      await expectGoalsSumToBalance();

      // The deposit itself never changes.
      expect(
        await prisma.operation.findUniqueOrThrow({
          where: { id: recorded.id },
        }),
      ).toMatchObject({ amount: 5000n, balanceAfter: 5000n, reason: null });
    });

    it('shows the correction in the staff and the customer history', async () => {
      const recorded = await deposit('5000');
      const corrected = await correct(recorded.id).expect(201);

      const staff = await api()
        .get(`/api/v1/stores/${storeId}/accounts/${accountId}/operations`)
        .set('Authorization', seller.authorization)
        .expect(200);
      const mine = await api()
        .get(`/api/v1/me/accounts/${accountId}/operations`)
        .set('Authorization', customer.authorization)
        .expect(200);

      for (const list of [staff, mine]) {
        expect(
          list.body.items.map(
            (op: { reference: string; correctedReference: string | null }) => [
              op.reference,
              op.correctedReference,
            ],
          ),
        ).toEqual([
          [corrected.body.reference, recorded.reference],
          [recorded.reference, null],
        ]);
      }
    });

    it('refuses more than what remains with 409 CORRECTION_EXCEEDS_DEPOSIT', async () => {
      const recorded = await deposit('5000');
      await correct(recorded.id, { amount: '3000', reason: 'Erreur' }).expect(
        201,
      );
      const before = await counts();

      await correct(recorded.id, { amount: '2001', reason: 'Erreur' })
        .expect(409)
        .expect((r) =>
          expect(r.body).toMatchObject({
            error: 'CORRECTION_EXCEEDS_DEPOSIT',
            message: `Il reste au plus 2000 XOF à corriger sur le dépôt ${recorded.reference}`,
          }),
        );
      expect(await counts()).toEqual(before);
    });

    it('takes from the deposit’s goal first, then from Unassigned', async () => {
      const goalId = await createGoal('Ciment');
      const recorded = await deposit('10000', { goalId });
      await deposit('5000');
      // The customer moved 7 000 out of the goal: it now holds 3 000.
      await api()
        .post(`/api/v1/me/accounts/${accountId}/goal-movements`)
        .set('Authorization', customer.authorization)
        .set('Idempotency-Key', randomUUID())
        .send({
          sourceGoalId: goalId,
          targetGoalId: await unassignedId(),
          amount: '7000',
        })
        .expect(201);

      const corrected = await correct(recorded.id, {
        amount: '9000',
        reason: 'Erreur',
      }).expect(201);

      expect(corrected.body.goal).toMatchObject({ id: goalId });
      expect(await goalBalance(goalId)).toBe(0n);
      expect(await goalBalance(await unassignedId())).toBe(6000n);
      expect(
        await prisma.goalMovement.findFirstOrThrow({
          where: { reason: 'CORRECTION_SHORTFALL' },
        }),
      ).toMatchObject({
        sourceGoalId: await unassignedId(),
        targetGoalId: goalId,
        amount: 6000n,
        authorId: manager.userId,
      });
      await expectGoalsSumToBalance();
    });

    it('takes it from Unassigned when the deposit’s goal is closed', async () => {
      const goalId = await createGoal('Tôles');
      const recorded = await deposit('8000', { goalId });
      await api()
        .post(`/api/v1/me/accounts/${accountId}/goals/${goalId}/close`)
        .set('Authorization', customer.authorization)
        .expect(200);

      const corrected = await correct(recorded.id, {
        amount: '8000',
        reason: 'Erreur',
      }).expect(201);

      expect(corrected.body.goal).toMatchObject({ label: 'Non affecté' });
      expect(await balanceOf()).toBe(0n);
      expect(
        await prisma.goalMovement.count({
          where: { reason: 'CORRECTION_SHORTFALL' },
        }),
      ).toBe(0);
      await expectGoalsSumToBalance();
    });

    it('refuses with 409 INSUFFICIENT_BALANCE when the goal and Unassigned hold too little', async () => {
      const cement = await createGoal('Ciment');
      const sheets = await createGoal('Tôles');
      const recorded = await deposit('10000', { goalId: cement });
      // Everything moved into a third goal, which a correction does not touch.
      await api()
        .post(`/api/v1/me/accounts/${accountId}/goal-movements`)
        .set('Authorization', customer.authorization)
        .set('Idempotency-Key', randomUUID())
        .send({ sourceGoalId: cement, targetGoalId: sheets, amount: '9000' })
        .expect(201);
      const before = await counts();

      await correct(recorded.id, { amount: '5000', reason: 'Erreur' })
        .expect(409)
        .expect((r) =>
          expect(r.body).toMatchObject({
            error: 'INSUFFICIENT_BALANCE',
            message: expect.stringContaining('1000 XOF'),
          }),
        );
      expect(await counts()).toEqual(before);
      expect(await balanceOf()).toBe(10000n);
    });

    it('refuses a material debit and a correction with 409 NOT_CORRECTABLE', async () => {
      const recorded = await deposit('50000');
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
          },
        })
      ).id;
      const order = await api()
        .post(`/api/v1/stores/${storeId}/accounts/${accountId}/orders`)
        .set('Authorization', seller.authorization)
        .send({ lines: [{ articleId, quantity: 2 }] })
        .expect(201);
      const confirmed = await api()
        .post(
          `/api/v1/me/accounts/${accountId}/orders/${order.body.id}/confirm`,
        )
        .set('Authorization', customer.authorization)
        .set('Idempotency-Key', randomUUID())
        .send({ pin: TEST_PIN })
        .expect(201);
      const debit = await prisma.operation.findUniqueOrThrow({
        where: { reference: confirmed.body.debitReference as string },
      });
      const correction = await correct(recorded.id).expect(201);

      for (const operationId of [debit.id, correction.body.id as string]) {
        await correct(operationId)
          .expect(409)
          .expect((r) => expect(r.body.error).toBe('NOT_CORRECTABLE'));
      }
    });

    it('is for the manager only: a seller gets 403 STORE_ROLE_REQUIRED', async () => {
      const recorded = await deposit('5000');

      await correct(recorded.id, undefined, { as: seller })
        .expect(403)
        .expect((r) => expect(r.body.error).toBe('STORE_ROLE_REQUIRED'));
      expect(await balanceOf()).toBe(5000n);
    });

    it('answers 404 for another store, another account, or an unknown operation', async () => {
      const recorded = await deposit('5000');
      const otherDeposit = await deposit('5000', { account: otherAccountId });

      await correct(recorded.id, undefined, { as: outsider })
        .expect(404)
        .expect((r) =>
          expect(r.body.message).toBe('Quincaillerie introuvable'),
        );
      await correct(recorded.id, undefined, {
        as: outsider,
        store: otherStoreId,
      })
        .expect(404)
        .expect((r) => expect(r.body.message).toBe('Compte introuvable'));
      // Another account's deposit, through this account's URL.
      await correct(otherDeposit.id)
        .expect(404)
        .expect((r) => expect(r.body.message).toBe('Opération introuvable'));
      await correct(randomUUID())
        .expect(404)
        .expect((r) => expect(r.body.message).toBe('Opération introuvable'));
      expect(
        await prisma.operation.count({ where: { type: 'CORRECTION' } }),
      ).toBe(0);
    });

    it('answers 400 for malformed ids', async () => {
      const recorded = await deposit('5000');

      await correct('d-1').expect(400);
      await correct(recorded.id, undefined, { account: 'c-1' }).expect(400);
    });

    it('refuses the manager’s own account with 409 OWN_ACCOUNT', async () => {
      const own = await openAccount(manager.phone);
      const recorded = await deposit('5000', { account: own.id });

      await correct(recorded.id, undefined, { account: own.id })
        .expect(409)
        .expect((r) => expect(r.body.error).toBe('OWN_ACCOUNT'));
    });

    it('refuses a closed store with 409 STORE_CLOSED, and corrects in a suspended one', async () => {
      const recorded = await deposit('5000');
      await prisma.hardwareStore.update({
        where: { id: storeId },
        data: { status: 'SUSPENDED' },
      });
      await correct(recorded.id).expect(201);

      await prisma.hardwareStore.update({
        where: { id: storeId },
        data: { status: 'CLOSED' },
      });
      await correct(recorded.id)
        .expect(409)
        .expect((r) => expect(r.body.error).toBe('STORE_CLOSED'));
      expect(await balanceOf()).toBe(4000n);
    });

    it.each([
      ['no amount', { reason: 'Erreur' }, 'amount'],
      ['a zero amount', { amount: '0', reason: 'Erreur' }, 'amount'],
      ['a negative amount', { amount: '-5', reason: 'Erreur' }, 'amount'],
      ['a decimal amount', { amount: '10.5', reason: 'Erreur' }, 'amount'],
      ['no reason', { amount: '1000' }, 'reason'],
      ['a blank reason', { amount: '1000', reason: '   ' }, 'reason'],
      [
        'a reason over 500 characters',
        { amount: '1000', reason: 'x'.repeat(501) },
        'reason',
      ],
    ])('refuses %s with a French 400', async (_, body, field) => {
      const recorded = await deposit('5000');

      await correct(recorded.id, body)
        .expect(400)
        .expect((r) =>
          expect(r.body.details).toContainEqual(
            expect.objectContaining({ field }),
          ),
        );
    });

    it('refuses a missing or invalid Idempotency-Key with 400', async () => {
      const recorded = await deposit('5000');

      for (const key of ['', 'not-a-uuid']) {
        await correct(recorded.id, undefined, { key })
          .expect(400)
          .expect((r) =>
            expect(r.body.details).toContainEqual(
              expect.objectContaining({ field: 'Idempotency-Key' }),
            ),
          );
      }
    });

    describe('idempotency', () => {
      it('answers a same-key retry with 200 and the same receipt, writing once', async () => {
        const recorded = await deposit('5000');
        const key = randomUUID();

        const first = await correct(recorded.id, undefined, { key }).expect(
          201,
        );
        const again = await correct(recorded.id, undefined, { key }).expect(
          200,
        );

        expect(again.body).toEqual(first.body);
        expect(await balanceOf()).toBe(4000n);
      });

      it('refuses a key reused for another amount with 409 IDEMPOTENCY_KEY_REUSED', async () => {
        const recorded = await deposit('5000');
        const key = randomUUID();
        await correct(recorded.id, undefined, { key }).expect(201);

        await correct(
          recorded.id,
          { amount: '2000', reason: 'Erreur' },
          { key },
        )
          .expect(409)
          .expect((r) => expect(r.body.error).toBe('IDEMPOTENCY_KEY_REUSED'));
        expect(await balanceOf()).toBe(4000n);
      });

      it('records once when the same key is sent in parallel', async () => {
        const recorded = await deposit('5000');
        const key = randomUUID();

        const statuses = (
          await Promise.all(
            [1, 2, 3].map(() => correct(recorded.id, undefined, { key })),
          )
        )
          .map((r) => r.status)
          .sort((a, b) => a - b);

        expect(statuses).toEqual([200, 200, 201]);
        expect(
          await prisma.operation.count({ where: { type: 'CORRECTION' } }),
        ).toBe(1);
        expect(await balanceOf()).toBe(4000n);
      });
    });

    describe('concurrency', () => {
      it('never over-corrects: of two parallel corrections over the deposit, one is refused', async () => {
        const recorded = await deposit('10000');

        const responses = await Promise.all([
          correct(recorded.id, { amount: '6000', reason: 'Erreur A' }),
          correct(recorded.id, { amount: '6000', reason: 'Erreur B' }),
        ]);

        expect(
          responses
            .map((r) => [r.status, r.status === 409 ? r.body.error : null])
            .sort((a, b) => Number(a[0]) - Number(b[0])),
        ).toEqual([
          [201, null],
          [409, 'CORRECTION_EXCEEDS_DEPOSIT'],
        ]);
        expect(await balanceOf()).toBe(4000n);
        await expectGoalsSumToBalance();
      });

      it('keeps an unbroken before/after chain with a parallel deposit', async () => {
        const recorded = await deposit('10000');

        await Promise.all([
          correct(recorded.id, { amount: '3000', reason: 'Erreur' }).expect(
            201,
          ),
          api()
            .post(`/api/v1/stores/${storeId}/accounts/${accountId}/deposits`)
            .set('Authorization', seller.authorization)
            .set('Idempotency-Key', randomUUID())
            .send({ amount: '2000' })
            .expect(201),
        ]);

        // Follow the chain from 0: each operation starts where one ended.
        const operations = await prisma.operation.findMany({
          where: { accountId },
        });
        let balance = 0n;
        for (let i = 0; i < operations.length; i++) {
          const next = operations.find((op) => op.balanceBefore === balance);
          expect(next).toBeDefined();
          balance = next!.balanceAfter;
        }
        expect(balance).toBe(9000n);
        expect(await balanceOf()).toBe(9000n);
        await expectGoalsSumToBalance();
      });
    });
  });

  describe('CORRECTION_RECORDED', () => {
    it('tells the customer in the app, by push, and by SMS', async () => {
      const recorded = await deposit('5000');
      await settled();
      sms.clear();
      push.clear();

      const corrected = await correct(recorded.id, {
        amount: '4500',
        reason: 'Erreur de saisie',
      }).expect(201);
      await settled();

      const rows = await prisma.notification.findMany({
        where: { type: 'CORRECTION_RECORDED' },
        orderBy: { channel: 'asc' },
      });
      expect(rows.map((row) => [row.channel, row.userId])).toEqual([
        ['APP', customer.userId],
        ['PUSH', customer.userId],
        ['SMS', customer.userId],
      ]);
      const body = `Correction de 4 500 XOF retirée de votre compte ${accountNumber} chez Quincaillerie du Carrefour (dépôt ${recorded.reference}) : « Erreur de saisie ». Nouveau solde : 500 XOF. Réf. ${corrected.body.reference}.`;
      expect(
        rows.every(
          (row) =>
            row.title === 'Correction de votre compte' &&
            row.body === body &&
            row.operationId === corrected.body.id,
        ),
      ).toBe(true);
      expect(sms.messages).toEqual([{ phone: customer.phone, text: body }]);
      expect(push.messages).toEqual([
        expect.objectContaining({ title: 'Correction de votre compte' }),
      ]);
    });

    it('tells nothing for a refusal or a replay', async () => {
      const recorded = await deposit('5000');
      const key = randomUUID();
      await correct(recorded.id, undefined, { key }).expect(201);
      await settled();

      await correct(recorded.id, undefined, { key }).expect(200);
      await correct(recorded.id, { amount: '9999', reason: 'Trop' }).expect(
        409,
      );
      await settled();

      expect(
        await prisma.notification.count({
          where: { type: 'CORRECTION_RECORDED' },
        }),
      ).toBe(3);
    });
  });
});
