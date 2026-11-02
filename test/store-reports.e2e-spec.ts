import type { INestApplication } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { createTestApp } from './utils/app.js';
import { createMali, createStoreRecord } from './utils/countries.js';
import { resetDatabase } from './utils/reset-database.js';
import { signedInStaff, type MobileStaff } from './utils/staff.js';

const DAY = { from: '2026-10-10', to: '2026-10-10' };
const IN_DAY = new Date('2026-10-10T12:00:00.000Z');

describe('Store reports (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let storeId: string;
  let otherStoreId: string;
  let manager: MobileStaff;
  let seller: MobileStaff;
  let outsider: MobileStaff;
  let customer: MobileStaff;
  let accountId: string;
  let goalId: string;
  let otherAccountId: string;
  let otherGoalId: string;
  let sequence = 0;

  beforeAll(async () => {
    app = await createTestApp();
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
      firstName: 'Moussa',
      store: { id: storeId, role: 'SELLER' },
    });
    outsider = await signedInStaff(app, prisma, {
      phone: '+22376000002',
      firstName: 'Ibrahim',
      store: { id: otherStoreId, role: 'MANAGER' },
    });
    customer = await signedInStaff(app, prisma, {
      phone: '+22376445566',
      firstName: 'Fanta',
    });
    ({ accountId, goalId } = await openAccount(
      customer.phone,
      storeId,
      seller,
    ));
    ({ accountId: otherAccountId, goalId: otherGoalId } = await openAccount(
      customer.phone,
      otherStoreId,
      outsider,
    ));
  });

  afterAll(async () => {
    await app.close();
  });

  const api = () => request(app.getHttpServer());

  async function openAccount(phone: string, store: string, as: MobileStaff) {
    const res = await api()
      .post(`/api/v1/stores/${store}/accounts`)
      .set('Authorization', as.authorization)
      .send({
        customer: { phone, firstName: 'F', lastName: 'K' },
        termsAccepted: true,
      })
      .expect(201);
    const id = (res.body as { id: string }).id;
    const goal = await prisma.goal.findFirstOrThrow({
      where: { accountId: id },
    });
    return { accountId: id, goalId: goal.id };
  }

  /** An operation written directly, to date it in the past. */
  const operation = (data: Record<string, unknown>) => {
    sequence += 1;
    return prisma.operation.create({
      data: {
        reference: `D-${String(sequence).padStart(5, '0')}`,
        accountId,
        storeId,
        goalId,
        type: 'DEPOSIT',
        amount: 1000n,
        direction: 'CREDIT',
        currencyCode: 'XOF',
        balanceBefore: 0n,
        balanceAfter: 1000n,
        status: 'CONFIRMED',
        channel: 'CASH',
        authorId: seller.userId,
        idempotencyKey: randomUUID(),
        createdAt: IN_DAY,
        ...data,
      } as never,
    });
  };

  const report = (
    path: string,
    query: Record<string, unknown>,
    as: MobileStaff = manager,
    store = storeId,
  ) =>
    api()
      .get(`/api/v1/stores/${store}/reports/${path}`)
      .set('Authorization', as.authorization)
      .query(query);

  describe('GET .../reports/totals', () => {
    it('adds up each kind of operation', async () => {
      const first = await operation({ amount: 20000n });
      await operation({ amount: 5000n, channel: 'MOBILE_MONEY' });
      await operation({
        type: 'CORRECTION',
        direction: 'DEBIT',
        amount: 3000n,
        correctedOperationId: first.id,
        reason: 'Erreur de saisie',
        authorId: manager.userId,
      });
      const debit = await operation({
        type: 'MATERIAL_DEBIT',
        direction: 'DEBIT',
        amount: 7000n,
      });
      await operation({
        type: 'CORRECTION',
        direction: 'CREDIT',
        amount: 7000n,
        correctedOperationId: debit.id,
        reason: 'Bon annulé',
        authorId: manager.userId,
      });

      const res = await report('totals', DAY).expect(200);

      expect(res.body).toEqual({
        ...DAY,
        currencyCode: 'XOF',
        deposits: { count: 2, total: '25000' },
        corrections: { count: 1, total: '3000' },
        purchases: { count: 1, total: '7000' },
        recredits: { count: 1, total: '7000' },
        netCash: '17000',
      });
    });

    it('counts cash only in the net cash, like a closing', async () => {
      await operation({ amount: 5000n, channel: 'MOBILE_MONEY' });

      const res = await report('totals', DAY).expect(200);

      expect(res.body).toMatchObject({
        deposits: { count: 1, total: '5000' },
        netCash: '0',
      });
    });

    it('stays inside the days, the first and last ones included', async () => {
      await operation({
        amount: 1n,
        createdAt: new Date('2026-10-09T23:59:59.999Z'),
      });
      await operation({
        amount: 10n,
        createdAt: new Date('2026-10-10T00:00:00.000Z'),
      });
      await operation({
        amount: 100n,
        createdAt: new Date('2026-10-10T23:59:59.999Z'),
      });
      await operation({
        amount: 1000n,
        createdAt: new Date('2026-10-11T00:00:00.000Z'),
      });

      const res = await report('totals', DAY).expect(200);

      expect(res.body).toMatchObject({
        deposits: { count: 2, total: '110' },
      });
    });

    it('leaves out another store and non-confirmed operations', async () => {
      await operation({
        storeId: otherStoreId,
        accountId: otherAccountId,
        goalId: otherGoalId,
      });
      await operation({ status: 'PENDING' });
      await operation({ status: 'FAILED' });
      await operation({ status: 'CANCELLED' });

      const res = await report('totals', DAY).expect(200);

      expect(res.body).toMatchObject({ deposits: { count: 0, total: '0' } });
    });

    it('answers zeros for an empty period', async () => {
      const res = await report('totals', DAY).expect(200);

      expect(res.body).toEqual({
        ...DAY,
        currencyCode: 'XOF',
        deposits: { count: 0, total: '0' },
        corrections: { count: 0, total: '0' },
        purchases: { count: 0, total: '0' },
        recredits: { count: 0, total: '0' },
        netCash: '0',
      });
    });

    it('can give a negative net cash', async () => {
      const old = await operation({ createdAt: new Date('2026-09-01') });
      await operation({
        type: 'CORRECTION',
        direction: 'DEBIT',
        amount: 400n,
        correctedOperationId: old.id,
        reason: 'Erreur de saisie',
      });

      const res = await report('totals', DAY).expect(200);

      expect(res.body).toMatchObject({ netCash: '-400' });
    });

    it.each([
      ['no dates', {}],
      ['no end', { from: '2026-10-01' }],
      ['a bad format', { from: '01/10/2026', to: '2026-10-31' }],
      ['a day that does not exist', { from: '2026-02-30', to: '2026-03-01' }],
      ['an end before the start', { from: '2026-10-31', to: '2026-10-01' }],
      ['more than a year', { from: '2025-01-01', to: '2026-02-01' }],
    ])('refuses %s', async (_, query) => {
      await report('totals', query).expect(400);
    });

    it('works in a closed store', async () => {
      await prisma.hardwareStore.update({
        where: { id: storeId },
        data: { status: 'CLOSED' },
      });

      await report('totals', DAY).expect(200);
    });

    it('is for the store’s manager only', async () => {
      const res = await report('totals', DAY, seller).expect(403);

      expect((res.body as { error: string }).error).toBe('STORE_ROLE_REQUIRED');
      await report('totals', DAY, outsider).expect(404);
      await report('totals', DAY, customer).expect(404);
      await api()
        .get(`/api/v1/stores/${storeId}/reports/totals`)
        .query(DAY)
        .expect(401);
    });
  });

  describe('GET .../reports/customers', () => {
    interface Row {
      accountId: string;
      accountNumber: string;
      firstName: string;
      lastDepositAt: string | null;
      status: string;
    }
    interface Report {
      items: Row[];
      total: number;
      page: number;
      pageSize: number;
      activeCount: number;
      inactiveCount: number;
    }

    const daysAgo = (days: number) =>
      new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    /** A customer of the store, with an account opened `openedDaysAgo`. */
    async function customerOpened(phone: string, openedDaysAgo: number) {
      await signedInStaff(app, prisma, { phone });
      const opened = await openAccount(phone, storeId, seller);
      await prisma.account.update({
        where: { id: opened.accountId },
        data: { createdAt: daysAgo(openedDaysAgo) },
      });
      return opened;
    }

    const customers = async (query: Record<string, unknown> = {}) =>
      (await report('customers', query).expect(200)).body as Report;

    const row = (body: Report, id: string) =>
      body.items.find((item) => item.accountId === id);

    it('calls a recent deposit active and an old one inactive', async () => {
      const recent = await customerOpened('+22376445501', 100);
      const old = await customerOpened('+22376445502', 100);
      await operation({ ...recent, createdAt: daysAgo(29) });
      await operation({ ...old, createdAt: daysAgo(31) });

      const body = await customers();

      expect(row(body, recent.accountId)?.status).toBe('ACTIVE');
      expect(row(body, old.accountId)?.status).toBe('INACTIVE');
    });

    it('goes by the last deposit, not an earlier one', async () => {
      const both = await customerOpened('+22376445501', 100);
      await operation({ ...both, createdAt: daysAgo(60) });
      const last = await operation({ ...both, createdAt: daysAgo(2) });

      const found = row(await customers(), both.accountId);

      expect(found?.lastDepositAt).toBe(last.createdAt.toISOString());
      expect(found?.status).toBe('ACTIVE');
    });

    it('counts a new account as active, and an old empty one as inactive', async () => {
      const fresh = await customerOpened('+22376445501', 3);
      const empty = await customerOpened('+22376445502', 45);

      const body = await customers();

      expect(row(body, fresh.accountId)).toMatchObject({
        status: 'ACTIVE',
        lastDepositAt: null,
      });
      expect(row(body, empty.accountId)).toMatchObject({
        status: 'INACTIVE',
        lastDepositAt: null,
      });
    });

    it('counts only confirmed deposits', async () => {
      const held = await customerOpened('+22376445501', 100);
      await operation({ ...held, status: 'PENDING', createdAt: daysAgo(1) });
      await operation({
        ...held,
        type: 'MATERIAL_DEBIT',
        direction: 'DEBIT',
        createdAt: daysAgo(1),
      });

      expect(row(await customers(), held.accountId)?.status).toBe('INACTIVE');
    });

    it('filters by status, and keeps both counts', async () => {
      const quiet = await customerOpened('+22376445501', 100);

      const inactive = await customers({ status: 'INACTIVE' });
      const active = await customers({ status: 'ACTIVE' });

      expect(inactive.items.map((item) => item.accountId)).toEqual([
        quiet.accountId,
      ]);
      expect(inactive.total).toBe(1);
      expect(active.items.map((item) => item.accountId)).toEqual([accountId]);
      expect(active.total).toBe(1);
      for (const body of [inactive, active]) {
        expect(body.activeCount).toBe(1);
        expect(body.inactiveCount).toBe(1);
      }
    });

    it('puts the quietest first, and pages', async () => {
      const oldest = await customerOpened('+22376445501', 300);
      const middle = await customerOpened('+22376445502', 200);

      const first = await customers({ page: 1, pageSize: 2 });
      const second = await customers({ page: 2, pageSize: 2 });

      expect(first.items.map((item) => item.accountId)).toEqual([
        oldest.accountId,
        middle.accountId,
      ]);
      expect(second.items.map((item) => item.accountId)).toEqual([accountId]);
      expect(first).toMatchObject({ total: 3, page: 1, pageSize: 2 });
    });

    it('leaves out another store, and holds no phone', async () => {
      const body = await customers();

      expect(row(body, otherAccountId)).toBeUndefined();
      expect(JSON.stringify(body)).not.toContain(customer.phone);
      expect(Object.keys(body.items[0]).sort()).toEqual([
        'accountId',
        'accountNumber',
        'balance',
        'firstName',
        'lastDepositAt',
        'lastName',
        'status',
      ]);
    });

    it('refuses a bad status, and is for the manager only', async () => {
      await report('customers', { status: 'SLEEPING' }).expect(400);
      await report('customers', {}, seller).expect(403);
      await report('customers', {}, outsider).expect(404);
    });
  });

  describe('GET .../reports/sellers', () => {
    interface Row {
      userId: string;
      firstName: string;
      role: string;
      active: boolean;
      deposits: { count: number; total: string };
      ordersPrepared: number;
      ordersPaid: { count: number; total: string };
      correctionsOnDeposits: number;
    }

    const IDLE = {
      deposits: { count: 0, total: '0' },
      ordersPrepared: 0,
      ordersPaid: { count: 0, total: '0' },
      correctionsOnDeposits: 0,
    };

    const order = (data: Record<string, unknown>) => {
      sequence += 1;
      return prisma.materialOrder.create({
        data: {
          reference: `B-${String(sequence).padStart(5, '0')}`,
          storeId,
          accountId,
          goalId,
          status: 'AWAITING_CUSTOMER',
          total: 1000n,
          createdById: seller.userId,
          createdAt: IN_DAY,
          ...data,
        } as never,
      });
    };

    const sellers = async (query = DAY) => {
      const res = await report('sellers', query).expect(200);
      return res.body as { currencyCode: string; staff: Row[] };
    };

    const rowOf = (staff: Row[], member: MobileStaff) =>
      staff.find((row) => row.userId === member.userId);

    it('counts the deposits of each member', async () => {
      await operation({ amount: 2000n });
      await operation({ amount: 3000n });
      await operation({ amount: 700n, authorId: manager.userId });
      await operation({ amount: 9n, status: 'PENDING' });
      await operation({ amount: 9n, createdAt: new Date('2026-10-09') });

      const { staff, currencyCode } = await sellers();

      expect(currencyCode).toBe('XOF');
      expect(rowOf(staff, seller)?.deposits).toEqual({
        count: 2,
        total: '5000',
      });
      expect(rowOf(staff, manager)?.deposits).toEqual({
        count: 1,
        total: '700',
      });
    });

    it('counts every order prepared, and the paid ones apart', async () => {
      await order({ status: 'AWAITING_VALIDATION', total: 11n });
      await order({ status: 'CANCELLED', total: 13n });
      await order({ status: 'REFUSED_BY_MANAGER', total: 17n });
      await order({ status: 'CONFIRMED', total: 100n });
      await order({ status: 'DELIVERED', total: 200n });
      await order({ status: 'CANCELLED_AFTER_DEBIT', total: 400n });
      await order({ status: 'CONFIRMED', createdAt: new Date('2026-10-09') });

      const row = rowOf((await sellers()).staff, seller);

      expect(row?.ordersPrepared).toBe(6);
      expect(row?.ordersPaid).toEqual({ count: 3, total: '700' });
    });

    it('counts a correction for the deposit’s author, not the manager', async () => {
      const deposit = await operation({ createdAt: new Date('2026-09-01') });
      await operation({
        type: 'CORRECTION',
        direction: 'DEBIT',
        amount: 100n,
        correctedOperationId: deposit.id,
        reason: 'Erreur de saisie',
        authorId: manager.userId,
      });
      await operation({
        type: 'CORRECTION',
        direction: 'DEBIT',
        amount: 100n,
        correctedOperationId: deposit.id,
        reason: 'Hors période',
        authorId: manager.userId,
        createdAt: new Date('2026-10-09'),
      });

      const { staff } = await sellers();

      expect(rowOf(staff, seller)?.correctionsOnDeposits).toBe(1);
      expect(rowOf(staff, manager)?.correctionsOnDeposits).toBe(0);
    });

    it('does not count the re-credit of an order as a correction', async () => {
      const debit = await operation({
        type: 'MATERIAL_DEBIT',
        direction: 'DEBIT',
      });
      await operation({
        type: 'CORRECTION',
        direction: 'CREDIT',
        correctedOperationId: debit.id,
        reason: 'Bon annulé',
        authorId: manager.userId,
      });

      expect(rowOf((await sellers()).staff, seller)).toMatchObject(IDLE);
    });

    it('shows an idle active member at zero, with their role', async () => {
      const { staff } = await sellers();

      expect(staff.map((row) => row.userId).sort()).toEqual(
        [manager.userId, seller.userId].sort(),
      );
      expect(rowOf(staff, seller)).toMatchObject({
        ...IDLE,
        role: 'SELLER',
        active: true,
      });
      expect(rowOf(staff, manager)?.role).toBe('MANAGER');
    });

    it('shows a former member only with activity in the period', async () => {
      const former = await signedInStaff(app, prisma, {
        phone: '+22376000009',
        firstName: 'Ali',
        store: { id: storeId, role: 'SELLER', active: false },
      });

      expect(rowOf((await sellers()).staff, former)).toBeUndefined();

      await operation({ authorId: former.userId });

      expect(rowOf((await sellers()).staff, former)).toMatchObject({
        active: false,
        deposits: { count: 1, total: '1000' },
      });
    });

    it('leaves out another store’s staff and activity', async () => {
      await operation({
        storeId: otherStoreId,
        accountId: otherAccountId,
        goalId: otherGoalId,
        authorId: seller.userId,
      });

      const { staff } = await sellers();

      expect(rowOf(staff, outsider)).toBeUndefined();
      expect(rowOf(staff, seller)).toMatchObject(IDLE);
    });

    it('orders the rows by name', async () => {
      await prisma.user.update({
        where: { id: seller.userId },
        data: { lastName: 'Ba' },
      });

      const { staff } = await sellers();

      expect(staff.map((row) => row.userId)).toEqual([
        seller.userId,
        manager.userId,
      ]);
    });

    it('holds no phone, refuses bad dates, and is for the manager only', async () => {
      const res = await report('sellers', DAY).expect(200);

      expect(JSON.stringify(res.body)).not.toContain(seller.phone);
      await report('sellers', { from: '2026-10-31', to: '2026-10-01' }).expect(
        400,
      );
      await report('sellers', DAY, seller).expect(403);
      await report('sellers', DAY, outsider).expect(404);
    });
  });
});
