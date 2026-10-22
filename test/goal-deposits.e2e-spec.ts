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

describe('Deposits into a goal, and reaching a target (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  const sms = new CapturingSmsSender();
  const push = new CapturingPushSender();
  let storeId: string;
  let seller: MobileStaff;
  let customer: MobileStaff;
  let accountId: string;
  let accountNumber: string;
  let unassignedId: string;
  let cementId: string;

  beforeAll(async () => {
    app = await createTestApp({ sms, push });
    prisma = app.get(PrismaService);
  });

  beforeEach(async () => {
    await resetDatabase(prisma);
    await createMali(prisma);
    storeId = (
      await createStoreRecord(prisma, {
        name: 'Quincaillerie du Carrefour',
        status: 'VERIFIED',
      })
    ).id;
    seller = await signedInStaff(app, prisma, {
      phone: '+22376000001',
      firstName: 'Moussa',
      store: { id: storeId, role: 'SELLER' },
    });
    customer = await signedInStaff(app, prisma, {
      phone: '+22376445566',
      firstName: 'Fanta',
    });
    await prisma.userDevice.updateMany({
      where: { deviceId: customer.deviceId },
      data: { pushToken: 'token-fanta-phone' },
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
    unassignedId = (
      await prisma.goal.findFirstOrThrow({
        where: { accountId, isSystem: true },
      })
    ).id;
    cementId = (
      await api()
        .post(`/api/v1/me/accounts/${accountId}/goals`)
        .set('Authorization', customer.authorization)
        .send({ label: 'Ciment', targetAmount: '150000' })
        .expect(201)
    ).body.id as string;
    sms.clear();
    push.clear();
  });

  afterAll(async () => {
    await app.close();
  });

  const api = () => request(app.getHttpServer());
  const deposit = (
    amount: string,
    goalId?: string,
    key: string = randomUUID(),
  ) =>
    api()
      .post(`/api/v1/stores/${storeId}/accounts/${accountId}/deposits`)
      .set('Authorization', seller.authorization)
      .set('Idempotency-Key', key)
      .send(goalId === undefined ? { amount } : { amount, goalId });
  const goalOf = (id: string) =>
    prisma.goal.findUniqueOrThrow({ where: { id } });
  const expectSumMatches = async () => {
    const account = await prisma.account.findUniqueOrThrow({
      where: { id: accountId },
      include: { goals: true },
    });
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
  const reachedRows = () =>
    prisma.notification.findMany({
      where: { type: 'GOAL_REACHED' },
      orderBy: { channel: 'asc' },
    });

  describe('choosing the goal', () => {
    it('puts the deposit into the chosen goal; the sum still matches', async () => {
      const response = await deposit('5000', cementId).expect(201);

      expect(response.body.goal).toEqual({ id: cementId, label: 'Ciment' });
      expect((await goalOf(cementId)).balance).toBe(5000n);
      expect((await goalOf(unassignedId)).balance).toBe(0n);
      await expectSumMatches();
    });

    it('still uses the Unassigned goal without a goalId', async () => {
      const response = await deposit('5000').expect(201);

      expect(response.body.goal.id).toBe(unassignedId);
      expect((await goalOf(unassignedId)).balance).toBe(5000n);
    });

    it('accepts the goal id in capitals', async () => {
      await deposit('5000', cementId.toUpperCase()).expect(201);

      expect((await goalOf(cementId)).balance).toBe(5000n);
    });

    it('answers 404 for a goal that is not this account’s, writing nothing', async () => {
      const response = await deposit('5000', randomUUID()).expect(404);

      expect(response.body.message).toBe('Objectif introuvable');
      expect(await prisma.operation.count()).toBe(0);
    });

    it('refuses a closed goal with 409 GOAL_CLOSED', async () => {
      await api()
        .post(`/api/v1/me/accounts/${accountId}/goals/${cementId}/close`)
        .set('Authorization', customer.authorization)
        .expect(200);

      const response = await deposit('5000', cementId).expect(409);

      expect(response.body.error).toBe('GOAL_CLOSED');
      expect(await prisma.operation.count()).toBe(0);
    });

    it('refuses a malformed goal id with a French 400', async () => {
      const response = await deposit('5000', 'goal-1').expect(400);

      expect(response.body.details).toEqual([
        { field: 'goalId', errors: ['Identifiant d’objectif invalide'] },
      ]);
    });

    it('answers a retry with the same goal, and refuses the key for another goal', async () => {
      const key = randomUUID();
      const first = await deposit('5000', cementId, key).expect(201);

      const retry = await deposit('5000', cementId, key).expect(200);
      expect(retry.body.reference).toBe(first.body.reference);

      await deposit('5000', undefined, key)
        .expect(409)
        .expect((r) => expect(r.body.error).toBe('IDEMPOTENCY_KEY_REUSED'));
      expect(await prisma.operation.count()).toBe(1);
    });
  });

  describe('reaching the target', () => {
    it('makes the goal REACHED and notifies in-app and by push, not by SMS', async () => {
      await deposit('100000', cementId).expect(201);
      expect((await goalOf(cementId)).status).toBe('IN_PROGRESS');

      const crossing = await deposit('50000', cementId).expect(201);
      await settled();

      expect(await goalOf(cementId)).toMatchObject({
        status: 'REACHED',
        balance: 150000n,
        reachedAt: expect.any(Date),
      });
      const body = `Votre objectif « Ciment » atteint 150 000 XOF (objectif : 150 000 XOF) sur votre compte ${accountNumber} chez Quincaillerie du Carrefour.`;
      expect(
        (await reachedRows()).map((row) => [row.channel, row.status]),
      ).toEqual([
        ['APP', 'SENT'],
        ['PUSH', 'SENT'],
      ]);
      for (const row of await reachedRows()) {
        expect(row).toMatchObject({
          userId: customer.userId,
          operationId: crossing.body.id,
          title: 'Objectif atteint',
          body,
        });
      }
      expect(push.messages).toContainEqual({
        token: 'token-fanta-phone',
        title: 'Objectif atteint',
        body,
      });
      // Two deposit SMS, no goal SMS.
      expect(sms.messages).toHaveLength(2);
      expect(sms.messages.every((m) => m.text.startsWith('Dépôt'))).toBe(true);
    });

    it('notifies once when one deposit jumps past the target', async () => {
      await deposit('200000', cementId).expect(201);
      await settled();

      expect((await goalOf(cementId)).status).toBe('REACHED');
      expect(
        await prisma.notification.count({
          where: { type: 'GOAL_REACHED', channel: 'APP' },
        }),
      ).toBe(1);
    });

    it('does not notify again for a goal already reached', async () => {
      await deposit('150000', cementId).expect(201);
      await deposit('5000', cementId).expect(201);
      await settled();

      expect(
        await prisma.notification.count({
          where: { type: 'GOAL_REACHED', channel: 'APP' },
        }),
      ).toBe(1);
    });

    it('never notifies for the Unassigned goal (it has no target)', async () => {
      await deposit('500000').expect(201);
      await settled();

      expect(await reachedRows()).toEqual([]);
    });

    it('notifies again once the target is raised and reached again', async () => {
      await deposit('150000', cementId).expect(201);
      await api()
        .patch(`/api/v1/me/accounts/${accountId}/goals/${cementId}`)
        .set('Authorization', customer.authorization)
        .send({ targetAmount: '200000' })
        .expect(200);
      expect((await goalOf(cementId)).status).toBe('IN_PROGRESS');

      await deposit('50000', cementId).expect(201);
      await settled();

      expect(
        await prisma.notification.count({
          where: { type: 'GOAL_REACHED', channel: 'APP' },
        }),
      ).toBe(2);
    });
  });
});
