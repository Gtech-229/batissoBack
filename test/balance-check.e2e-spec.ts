import type { INestApplication } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { SchedulerRegistry } from '@nestjs/schedule';
import { BALANCE_CHECK_JOB } from '../src/admin-alerts/balance-check.job.js';
import { BalanceCheckService } from '../src/admin-alerts/balance-check.service.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { createTestApp } from './utils/app.js';
import { createMali, createStoreRecord } from './utils/countries.js';
import { resetDatabase } from './utils/reset-database.js';
import { signedInStaff, type MobileStaff } from './utils/staff.js';
import { TEST_PIN } from './utils/users.js';

describe('Nightly balance check (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let check: BalanceCheckService;
  let storeId: string;
  let seller: MobileStaff;
  let customer: MobileStaff;
  let accountId: string;
  let unassignedId: string;
  let cementId: string;

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
    check = app.get(BalanceCheckService);
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
    accountId = (
      await api()
        .post(`/api/v1/stores/${storeId}/accounts`)
        .set('Authorization', seller.authorization)
        .send({
          customer: { phone: customer.phone, firstName: 'F', lastName: 'K' },
          termsAccepted: true,
        })
        .expect(201)
    ).body.id as string;
    unassignedId = (
      await prisma.goal.findFirstOrThrow({
        where: { accountId, isSystem: true },
      })
    ).id;
    await deposit('50000');
    cementId = (
      await api()
        .post(`/api/v1/me/accounts/${accountId}/goals`)
        .set('Authorization', customer.authorization)
        .send({ label: 'Ciment', targetAmount: '150000' })
        .expect(201)
    ).body.id as string;
    await api()
      .post(`/api/v1/me/accounts/${accountId}/goal-movements`)
      .set('Authorization', customer.authorization)
      .set('Idempotency-Key', randomUUID())
      .send({
        sourceGoalId: unassignedId,
        targetGoalId: cementId,
        amount: '20000',
      })
      .expect(201);
  });

  afterAll(async () => {
    await app.close();
  });

  const api = () => request(app.getHttpServer());
  const deposit = (amount: string) =>
    api()
      .post(`/api/v1/stores/${storeId}/accounts/${accountId}/deposits`)
      .set('Authorization', seller.authorization)
      .set('Idempotency-Key', randomUUID())
      .send({ amount })
      .expect(201);
  const alerts = () =>
    prisma.adminAlert.findMany({ orderBy: [{ type: 'asc' }] });
  const shift = (table: 'accounts' | 'goals', id: string, by: bigint) =>
    prisma.$executeRawUnsafe(
      `UPDATE "${table}" SET "balance" = "balance" + $1 WHERE "id" = $2::uuid`,
      by,
      id,
    );

  it('finds no gap in a ledger written through the API', async () => {
    await deposit('7000');

    const result = await check.run();

    expect(result).toEqual({ accountsChecked: 1, alertsCreated: 0 });
    expect(await alerts()).toEqual([]);
  });

  it('finds no gap after a correction debit and a purchase that takes a goal shortfall (F-58)', async () => {
    const manager = await signedInStaff(app, prisma, {
      phone: '+22376000002',
      store: { id: storeId, role: 'MANAGER' },
    });
    // Unassigned 30 000, Ciment 20 000 (beforeEach). A 7 000 deposit to
    // Unassigned, then 2 000 of it taken back by a correction (a DEBIT).
    const recorded = (await deposit('7000')).body as { id: string };
    await api()
      .post(
        `/api/v1/stores/${storeId}/accounts/${accountId}/operations/${recorded.id}/corrections`,
      )
      .set('Authorization', manager.authorization)
      .set('Idempotency-Key', randomUUID())
      .send({ amount: '2000', reason: 'Erreur de saisie' })
      .expect(201);
    // A 25 000 order on Ciment (20 000): 5 000 come from Unassigned (a goal
    // movement), then one MATERIAL_DEBIT of 25 000 on Ciment.
    const categoryId = (
      await prisma.articleCategory.create({ data: { storeId, name: 'Fer' } })
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
    const order = (
      await api()
        .post(`/api/v1/stores/${storeId}/accounts/${accountId}/orders`)
        .set('Authorization', seller.authorization)
        .send({ goalId: cementId, lines: [{ articleId, quantity: 5 }] })
        .expect(201)
    ).body as { id: string };
    await api()
      .post(`/api/v1/me/accounts/${accountId}/orders/${order.id}/confirm`)
      .set('Authorization', customer.authorization)
      .set('Idempotency-Key', randomUUID())
      .send({ pin: TEST_PIN })
      .expect(201);

    // The ledger really holds debits and a shortfall movement.
    expect(
      (
        await prisma.operation.findMany({
          where: { direction: 'DEBIT' },
          orderBy: { amount: 'asc' },
        })
      ).map((o) => [o.type, o.amount]),
    ).toEqual([
      ['CORRECTION', 2000n],
      ['MATERIAL_DEBIT', 25000n],
    ]);
    expect(
      await prisma.goalMovement.count({ where: { reason: 'ORDER_SHORTFALL' } }),
    ).toBe(1);

    const result = await check.run();

    expect(result.alertsCreated).toBe(0);
    expect(await alerts()).toEqual([]);
  });

  it('reports an account balance that is not its operations, and the goal sum it breaks', async () => {
    await shift('accounts', accountId, 300n);

    const result = await check.run();

    expect(result.alertsCreated).toBe(2);
    expect(await alerts()).toEqual([
      expect.objectContaining({
        type: 'ACCOUNT_BALANCE_GAP',
        storeId,
        accountId,
        goalId: null,
        difference: 300n,
        resolvedAt: null,
      }),
      expect.objectContaining({
        type: 'GOAL_SUM_GAP',
        storeId,
        accountId,
        goalId: null,
        difference: 300n,
      }),
    ]);
  });

  it('reports a goal balance that is not its operations and movements', async () => {
    await shift('goals', cementId, -500n);

    await check.run();

    expect(await alerts()).toEqual([
      expect.objectContaining({
        type: 'GOAL_BALANCE_GAP',
        accountId,
        goalId: cementId,
        difference: -500n,
      }),
      // The goals now sum to 500 less than the account.
      expect.objectContaining({
        type: 'GOAL_SUM_GAP',
        accountId,
        goalId: null,
        difference: 500n,
      }),
    ]);
  });

  it('reports the account and the goal, not the sum, when both drift by the same amount', async () => {
    // The goals still add up to the account, but neither matches the ledger.
    await shift('accounts', accountId, 100n);
    await shift('goals', unassignedId, 100n);

    await check.run();

    expect((await alerts()).map((a) => a.type)).toEqual([
      'ACCOUNT_BALANCE_GAP',
      'GOAL_BALANCE_GAP',
    ]);
  });

  it('adds nothing on a second run while the alert is open, and again after it is resolved', async () => {
    await shift('accounts', accountId, 300n);
    await check.run();

    const second = await check.run();
    expect(second.alertsCreated).toBe(0);
    expect(await prisma.adminAlert.count()).toBe(2);

    await prisma.adminAlert.updateMany({ data: { resolvedAt: new Date() } });
    const third = await check.run();
    expect(third.alertsCreated).toBe(2);
    expect(await prisma.adminAlert.count()).toBe(4);
  });

  it('never changes a balance', async () => {
    await shift('accounts', accountId, 300n);
    const before = await prisma.account.findUniqueOrThrow({
      where: { id: accountId },
    });

    await check.run();

    const after = await prisma.account.findUniqueOrThrow({
      where: { id: accountId },
    });
    expect(after.balance).toBe(before.balance);
  });

  it('checks every account, including those without operations', async () => {
    const other = await signedInStaff(app, prisma, { phone: '+22376112233' });
    await api()
      .post(`/api/v1/stores/${storeId}/accounts`)
      .set('Authorization', seller.authorization)
      .send({
        customer: { phone: other.phone, firstName: 'A', lastName: 'B' },
        termsAccepted: true,
      })
      .expect(201);

    const result = await check.run();

    expect(result).toEqual({ accountsChecked: 2, alertsCreated: 0 });
  });

  it('schedules the check every night at 02:00 UTC', () => {
    const job = app.get(SchedulerRegistry).getCronJob(BALANCE_CHECK_JOB);

    expect(job.cronTime.source).toBe('0 2 * * *');
    expect(job.cronTime.timeZone).toBe('UTC');
    expect(job.isActive).toBe(true);
  });
});
