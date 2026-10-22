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

describe('Moving money between goals (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  const sms = new CapturingSmsSender();
  const push = new CapturingPushSender();
  let storeId: string;
  let seller: MobileStaff;
  let customer: MobileStaff;
  let other: MobileStaff;
  let accountId: string;
  let otherAccountId: string;
  let unassignedId: string;
  let cementId: string;
  let ironId: string;

  beforeAll(async () => {
    app = await createTestApp({ sms, push });
    prisma = app.get(PrismaService);
  });

  beforeEach(async () => {
    await resetDatabase(prisma);
    await createMali(prisma);
    storeId = (await createStoreRecord(prisma, { status: 'VERIFIED' })).id;
    seller = await signedInStaff(app, prisma, {
      phone: '+22376000001',
      store: { id: storeId, role: 'SELLER' },
    });
    customer = await signedInStaff(app, prisma, { phone: '+22376445566' });
    other = await signedInStaff(app, prisma, { phone: '+22376112233' });
    await prisma.userDevice.updateMany({
      where: { deviceId: customer.deviceId },
      data: { pushToken: 'token-fanta-phone' },
    });
    accountId = await openAccount(customer.phone);
    otherAccountId = await openAccount(other.phone);
    unassignedId = (
      await prisma.goal.findFirstOrThrow({
        where: { accountId, isSystem: true },
      })
    ).id;
    await api()
      .post(`/api/v1/stores/${storeId}/accounts/${accountId}/deposits`)
      .set('Authorization', seller.authorization)
      .set('Idempotency-Key', randomUUID())
      .send({ amount: '50000' })
      .expect(201);
    cementId = await createGoal('Ciment', '150000');
    ironId = await createGoal('Fer', '30000');
    sms.clear();
    push.clear();
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
          customer: { phone, firstName: 'X', lastName: 'Y' },
          termsAccepted: true,
        })
        .expect(201)
    ).body.id as string;
  const createGoal = async (label: string, targetAmount: string) =>
    (
      await api()
        .post(`/api/v1/me/accounts/${accountId}/goals`)
        .set('Authorization', customer.authorization)
        .send({ label, targetAmount })
        .expect(201)
    ).body.id as string;
  const move = (
    sourceGoalId: string,
    targetGoalId: string,
    amount: string,
    options: { key?: string | null; as?: MobileStaff; account?: string } = {},
  ) => {
    const call = api()
      .post(
        `/api/v1/me/accounts/${options.account ?? accountId}/goal-movements`,
      )
      .set('Authorization', (options.as ?? customer).authorization);
    if (options.key !== null) {
      call.set('Idempotency-Key', options.key ?? randomUUID());
    }
    return call.send({ sourceGoalId, targetGoalId, amount });
  };
  const balanceOf = async (goalId: string) =>
    (await prisma.goal.findUniqueOrThrow({ where: { id: goalId } })).balance;
  const expectSumMatches = async () => {
    const account = await prisma.account.findUniqueOrThrow({
      where: { id: accountId },
      include: { goals: true },
    });
    expect(account.balance).toBe(50000n);
    expect(
      account.goals.reduce((total, goal) => total + goal.balance, 0n),
    ).toBe(account.balance);
  };
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

  describe('POST /me/accounts/:accountId/goal-movements', () => {
    it('moves money between two goals; the account balance does not change', async () => {
      const response = await move(unassignedId, cementId, '20000').expect(201);

      expect(response.body).toEqual({
        id: expect.any(String),
        sourceGoal: { id: unassignedId, label: 'Non affecté' },
        targetGoal: { id: cementId, label: 'Ciment' },
        amount: '20000',
        reason: 'MOVE',
        createdAt: expect.any(String),
      });
      expect(await balanceOf(unassignedId)).toBe(30000n);
      expect(await balanceOf(cementId)).toBe(20000n);
      expect(await prisma.goalMovement.findFirstOrThrow()).toMatchObject({
        authorId: customer.userId,
        device: customer.deviceId,
        reason: 'MOVE',
      });
      // A move is not an operation: only the opening deposit exists.
      expect(await prisma.operation.count()).toBe(1);
      await expectSumMatches();
    });

    it('moves between two of the customer’s goals, back and forth', async () => {
      await move(unassignedId, cementId, '20000').expect(201);
      await move(cementId, ironId, '5000').expect(201);
      await move(ironId, unassignedId, '5000').expect(201);

      expect(await balanceOf(cementId)).toBe(15000n);
      expect(await balanceOf(ironId)).toBe(0n);
      expect(await balanceOf(unassignedId)).toBe(35000n);
      await expectSumMatches();
    });

    it('refuses more than the source holds with 409 INSUFFICIENT_GOAL_BALANCE', async () => {
      const response = await move(cementId, ironId, '1000').expect(409);

      expect(response.body).toMatchObject({
        error: 'INSUFFICIENT_GOAL_BALANCE',
        message: 'Cet objectif ne contient que 0 XOF',
      });
      expect(await prisma.goalMovement.count()).toBe(0);
      await expectSumMatches();
    });

    it('never lets parallel moves take more than a goal holds', async () => {
      const responses = await Promise.all([
        move(unassignedId, cementId, '30000'),
        move(unassignedId, ironId, '30000'),
      ]);

      expect(responses.map((r) => r.status).sort((a, b) => a - b)).toEqual([
        201, 409,
      ]);
      expect(await balanceOf(unassignedId)).toBe(20000n);
      await expectSumMatches();
    });

    it('notifies when a move makes the target goal reach its target', async () => {
      await move(unassignedId, ironId, '30000').expect(201);
      await settled();

      expect(
        await prisma.goal.findUniqueOrThrow({ where: { id: ironId } }),
      ).toMatchObject({ status: 'REACHED', reachedAt: expect.any(Date) });
      const rows = await prisma.notification.findMany({
        where: { type: 'GOAL_REACHED' },
        orderBy: { channel: 'asc' },
      });
      expect(rows.map((row) => [row.channel, row.operationId])).toEqual([
        ['APP', null],
        ['PUSH', null],
      ]);
      expect(push.messages).toEqual([
        expect.objectContaining({ title: 'Objectif atteint' }),
      ]);
      expect(sms.messages).toEqual([]);
    });

    it('returns a source to IN_PROGRESS silently when it falls below its target', async () => {
      await move(unassignedId, ironId, '30000').expect(201);
      await settled();

      await move(ironId, unassignedId, '1000').expect(201);
      await settled();

      expect(
        await prisma.goal.findUniqueOrThrow({ where: { id: ironId } }),
      ).toMatchObject({ status: 'IN_PROGRESS', reachedAt: null });
      expect(
        await prisma.notification.count({
          where: { type: 'GOAL_REACHED', channel: 'APP' },
        }),
      ).toBe(1);
    });

    it('refuses a closed target with 409 GOAL_CLOSED', async () => {
      await api()
        .post(`/api/v1/me/accounts/${accountId}/goals/${cementId}/close`)
        .set('Authorization', customer.authorization)
        .expect(200);

      await move(unassignedId, cementId, '1000')
        .expect(409)
        .expect((r) => expect(r.body.error).toBe('GOAL_CLOSED'));
    });

    it('refuses the same goal at both ends with a 400', async () => {
      const response = await move(
        cementId,
        cementId.toUpperCase(),
        '1000',
      ).expect(400);

      expect(response.body.message).toBe(
        'L’objectif de départ et celui d’arrivée doivent être différents',
      );
    });

    it.each([
      ['a zero amount', () => move(unassignedId, cementId, '0'), 'amount'],
      [
        'a malformed goal id',
        () => move('g-1', cementId, '1000'),
        'sourceGoalId',
      ],
    ])('refuses %s with a French 400', async (_, send, field) => {
      const response = await send().expect(400);

      expect(response.body.details).toContainEqual(
        expect.objectContaining({ field }),
      );
    });

    it('answers 404 for a goal of another account', async () => {
      const foreign = (
        await prisma.goal.findFirstOrThrow({
          where: { accountId: otherAccountId },
        })
      ).id;

      await move(unassignedId, foreign, '1000')
        .expect(404)
        .expect((r) => expect(r.body.message).toBe('Objectif introuvable'));
      expect(await balanceOf(unassignedId)).toBe(50000n);
    });

    it('answers 404 to another customer and to staff through /me', async () => {
      await move(unassignedId, cementId, '1000', { as: other }).expect(404);
      await move(unassignedId, cementId, '1000', { as: seller }).expect(404);
    });

    it('answers a retry with the recorded move, and refuses the key for another move', async () => {
      const key = randomUUID();
      const first = await move(unassignedId, cementId, '20000', { key }).expect(
        201,
      );

      const retry = await move(unassignedId, cementId, '20000', { key }).expect(
        200,
      );
      expect(retry.body).toEqual(first.body);
      expect(await balanceOf(cementId)).toBe(20000n);

      await move(unassignedId, cementId, '10000', { key })
        .expect(409)
        .expect((r) => expect(r.body.error).toBe('IDEMPOTENCY_KEY_REUSED'));
      expect(await prisma.goalMovement.count()).toBe(1);
    });

    it('moves once when the same key is sent twice in parallel', async () => {
      const key = randomUUID();

      const responses = await Promise.all([
        move(unassignedId, cementId, '20000', { key }),
        move(unassignedId, cementId, '20000', { key }),
      ]);

      expect(responses.map((r) => r.status).sort((a, b) => a - b)).toEqual([
        200, 201,
      ]);
      expect(await balanceOf(cementId)).toBe(20000n);
      expect(await prisma.goalMovement.count()).toBe(1);
    });

    it('refuses a missing key with a French 400', async () => {
      await move(unassignedId, cementId, '1000', { key: null }).expect(400);
      expect(await prisma.goalMovement.count()).toBe(0);
    });
  });

  describe('GET /me/accounts/:accountId/goal-movements', () => {
    it('lists moves and closings, newest first', async () => {
      await move(unassignedId, cementId, '20000').expect(201);
      await api()
        .post(`/api/v1/me/accounts/${accountId}/goals/${cementId}/close`)
        .set('Authorization', customer.authorization)
        .expect(200);

      const response = await api()
        .get(`/api/v1/me/accounts/${accountId}/goal-movements`)
        .set('Authorization', customer.authorization)
        .expect(200);

      expect(response.body).toMatchObject({ total: 2, page: 1, pageSize: 20 });
      expect(
        (response.body.items as { reason: string; amount: string }[]).map(
          (item) => [item.reason, item.amount],
        ),
      ).toEqual([
        ['GOAL_CLOSED', '20000'],
        ['MOVE', '20000'],
      ]);
      const json = JSON.stringify(response.body);
      expect(json).not.toContain(customer.deviceId);
      expect(json).not.toContain('idempotencyKey');
    });

    it('answers 404 to another customer', async () => {
      await api()
        .get(`/api/v1/me/accounts/${accountId}/goal-movements`)
        .set('Authorization', other.authorization)
        .expect(404);
    });
  });
});
