import type { INestApplication } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { createTestApp } from './utils/app.js';
import { createMali, createStoreRecord } from './utils/countries.js';
import { resetDatabase } from './utils/reset-database.js';
import { signedInStaff, type MobileStaff } from './utils/staff.js';

type Receipt = { id: string; reference: string; amount: string };

describe('Operation history and receipts (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let storeId: string;
  let manager: MobileStaff;
  let seller: MobileStaff;
  let accountId: string;
  let otherAccountId: string;

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
      firstName: 'Awa',
      store: { id: storeId, role: 'MANAGER' },
    });
    seller = await signedInStaff(app, prisma, {
      phone: '+22376000001',
      firstName: 'Moussa',
      store: { id: storeId, role: 'SELLER' },
    });
    accountId = await openAccount('76 44 55 66', 'Fanta');
    otherAccountId = await openAccount('76 11 22 33', 'Ali');
  });

  afterAll(async () => {
    await app.close();
  });

  const api = () => request(app.getHttpServer());
  const openAccount = async (phone: string, firstName: string) =>
    (
      await api()
        .post(`/api/v1/stores/${storeId}/accounts`)
        .set('Authorization', seller.authorization)
        .send({
          customer: { phone, firstName, lastName: 'Keita' },
          termsAccepted: true,
        })
        .expect(201)
    ).body.id as string;
  const deposit = async (amount: string, account = accountId) =>
    (
      await api()
        .post(`/api/v1/stores/${storeId}/accounts/${account}/deposits`)
        .set('Authorization', seller.authorization)
        .set('Idempotency-Key', randomUUID())
        .send({ amount })
        .expect(201)
    ).body as Receipt;
  const history = (
    query: Record<string, number> = {},
    options: { as?: MobileStaff; account?: string; store?: string } = {},
  ) =>
    api()
      .get(
        `/api/v1/stores/${options.store ?? storeId}/accounts/${options.account ?? accountId}/operations`,
      )
      .query(query)
      .set('Authorization', (options.as ?? seller).authorization);
  const receipt = (
    operationId: string,
    options: { as?: MobileStaff; account?: string; store?: string } = {},
  ) =>
    api()
      .get(
        `/api/v1/stores/${options.store ?? storeId}/accounts/${options.account ?? accountId}/operations/${operationId}`,
      )
      .set('Authorization', (options.as ?? seller).authorization);
  const otherStoreManager = async () => {
    const otherStoreId = (
      await createStoreRecord(prisma, { status: 'VERIFIED' })
    ).id;
    return {
      otherStoreId,
      otherManager: await signedInStaff(app, prisma, {
        phone: '+22376000002',
        store: { id: otherStoreId, role: 'MANAGER' },
      }),
    };
  };

  describe('GET /stores/:storeId/accounts/:accountId/operations', () => {
    it('lists the account’s operations newest first, as receipts', async () => {
      const first = await deposit('5000');
      const second = await deposit('2500');
      await deposit('1000', otherAccountId);

      const response = await history().expect(200);

      expect(response.body).toMatchObject({ total: 2, page: 1, pageSize: 20 });
      expect(response.body.items).toEqual([
        expect.objectContaining({
          id: second.id,
          amount: '2500',
          balanceBefore: '5000',
          balanceAfter: '7500',
        }),
        expect.objectContaining({ id: first.id, amount: '5000' }),
      ]);
    });

    it('gives a manager the same history', async () => {
      await deposit('5000');

      await history({}, { as: manager })
        .expect(200)
        .expect((r) => expect(r.body.total).toBe(1));
    });

    it('gives an empty page to an account with no operation', async () => {
      const response = await history().expect(200);

      expect(response.body).toEqual({
        items: [],
        total: 0,
        page: 1,
        pageSize: 20,
      });
    });

    it('pages the history with the real total', async () => {
      const oldest = await deposit('1000');
      await deposit('1000');
      await deposit('1000');

      const response = await history({ page: 2, pageSize: 2 }).expect(200);

      expect(response.body).toMatchObject({ total: 3, page: 2, pageSize: 2 });
      expect((response.body.items as Receipt[]).map((r) => r.id)).toEqual([
        oldest.id,
      ]);
    });

    it.each([
      ['page 0', { page: 0 }, 'page'],
      ['a page size above 100', { pageSize: 101 }, 'pageSize'],
    ])('refuses %s with a French 400', async (_, query, field) => {
      const response = await history(query).expect(400);

      expect(response.body.details).toContainEqual(
        expect.objectContaining({ field }),
      );
    });

    it('stays readable when the store is suspended', async () => {
      await deposit('5000');
      await prisma.hardwareStore.update({
        where: { id: storeId },
        data: { status: 'SUSPENDED' },
      });

      await history()
        .expect(200)
        .expect((r) => expect(r.body.total).toBe(1));
    });

    it('answers 404 for another store’s account', async () => {
      await deposit('5000');
      const { otherStoreId, otherManager } = await otherStoreManager();

      const response = await history(
        {},
        { as: otherManager, store: otherStoreId },
      ).expect(404);

      expect(response.body.message).toBe('Compte introuvable');
    });

    it('answers 404 to a member of another store, 400 to a malformed id', async () => {
      const { otherManager } = await otherStoreManager();

      await history({}, { as: otherManager }).expect(404);
      await history({}, { account: 'not-a-uuid' })
        .expect(400)
        .expect((r) =>
          expect(r.body.message).toBe('Identifiant de compte invalide'),
        );
    });
  });

  describe('GET /stores/:storeId/accounts/:accountId/operations/:operationId', () => {
    it('gives the receipt recorded with the deposit', async () => {
      const recorded = await deposit('5000');

      const response = await receipt(recorded.id).expect(200);

      expect(response.body).toEqual(recorded);
    });

    it.each([
      [
        'an operation of another account',
        async () => (await deposit('5000', otherAccountId)).id,
      ],
      ['an unknown id', () => Promise.resolve(randomUUID())],
    ])('answers 404 to %s', async (_, operationId) => {
      const response = await receipt(await operationId()).expect(404);

      expect(response.body.message).toBe('Opération introuvable');
    });

    it('answers 404 for another store’s account, even with the right ids', async () => {
      const recorded = await deposit('5000');
      const { otherStoreId, otherManager } = await otherStoreManager();

      await receipt(recorded.id, {
        as: otherManager,
        store: otherStoreId,
      }).expect(404);
    });

    it('answers 400 to a malformed operation id', async () => {
      const response = await receipt('not-a-uuid').expect(400);

      expect(response.body.message).toBe('Identifiant d’opération invalide');
    });
  });

  describe('goal balances in account views', () => {
    it('shows the Unassigned goal’s balance, equal to the account balance', async () => {
      await deposit('5000');
      await deposit('2500');

      const detail = await api()
        .get(`/api/v1/stores/${storeId}/accounts/${accountId}`)
        .set('Authorization', seller.authorization)
        .expect(200);

      expect(detail.body.balance).toBe('7500');
      expect(detail.body.goals).toEqual([
        expect.objectContaining({
          label: 'Non affecté',
          isSystem: true,
          balance: '7500',
        }),
      ]);
    });
  });
});
