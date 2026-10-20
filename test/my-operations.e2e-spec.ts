import type { INestApplication } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { createTestApp } from './utils/app.js';
import { createMali, createStoreRecord } from './utils/countries.js';
import { resetDatabase } from './utils/reset-database.js';
import { signedInStaff, type MobileStaff } from './utils/staff.js';

type Receipt = { id: string; reference: string };

describe('The customer’s history and receipts (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let storeId: string;
  let seller: MobileStaff;
  // signedInStaff also signs in plain customers: a user with a PIN and a device.
  let fanta: MobileStaff;
  let ali: MobileStaff;
  let fantaAccount: string;
  let aliAccount: string;

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
  });

  beforeEach(async () => {
    await resetDatabase(prisma);
    await createMali(prisma);
    storeId = (await createStoreRecord(prisma, { status: 'VERIFIED' })).id;
    seller = await signedInStaff(app, prisma, {
      phone: '+22376000001',
      firstName: 'Moussa',
      store: { id: storeId, role: 'SELLER' },
    });
    fanta = await signedInStaff(app, prisma, {
      phone: '+22376445566',
      firstName: 'Fanta',
    });
    ali = await signedInStaff(app, prisma, {
      phone: '+22376112233',
      firstName: 'Ali',
    });
    fantaAccount = await openAccount(fanta.phone);
    aliAccount = await openAccount(ali.phone);
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
  const deposit = async (amount: string, account = fantaAccount) =>
    (
      await api()
        .post(`/api/v1/stores/${storeId}/accounts/${account}/deposits`)
        .set('Authorization', seller.authorization)
        .set('Idempotency-Key', randomUUID())
        .send({ amount })
        .expect(201)
    ).body as Receipt;
  const myHistory = (
    as: MobileStaff,
    account = fantaAccount,
    query: Record<string, number> = {},
  ) =>
    api()
      .get(`/api/v1/me/accounts/${account}/operations`)
      .query(query)
      .set('Authorization', as.authorization);
  const myReceipt = (as: MobileStaff, account: string, operationId: string) =>
    api()
      .get(`/api/v1/me/accounts/${account}/operations/${operationId}`)
      .set('Authorization', as.authorization);

  describe('GET /me/accounts/:accountId/operations', () => {
    it('gives the customer their history, newest first, as receipts', async () => {
      const first = await deposit('5000');
      const second = await deposit('2500');
      await deposit('1000', aliAccount);

      const response = await myHistory(fanta).expect(200);

      expect(response.body).toMatchObject({ total: 2, page: 1, pageSize: 20 });
      expect(response.body.items).toEqual([second, first]);
    });

    it('pages the history', async () => {
      const oldest = await deposit('1000');
      await deposit('1000');

      const response = await myHistory(fanta, fantaAccount, {
        page: 2,
        pageSize: 1,
      }).expect(200);

      expect(response.body).toMatchObject({ total: 2, page: 2, pageSize: 1 });
      expect((response.body.items as Receipt[]).map((r) => r.id)).toEqual([
        oldest.id,
      ]);
    });

    it.each([
      ['another customer', () => ali],
      ['a staff member of the store', () => seller],
    ])('answers 404 to %s reading the customer’s account', async (_, who) => {
      await deposit('5000');

      const response = await myHistory(who()).expect(404);

      expect(response.body.message).toBe('Compte introuvable');
    });

    it('answers 404 to an unknown account, 400 to a malformed id, 401 without a session', async () => {
      await myHistory(fanta, randomUUID()).expect(404);
      await myHistory(fanta, 'not-a-uuid')
        .expect(400)
        .expect((r) =>
          expect(r.body.message).toBe('Identifiant de compte invalide'),
        );
      await api()
        .get(`/api/v1/me/accounts/${fantaAccount}/operations`)
        .expect(401);
    });
  });

  describe('GET /me/accounts/:accountId/operations/:operationId', () => {
    it('gives the customer the receipt of their operation', async () => {
      const recorded = await deposit('5000');

      const response = await myReceipt(fanta, fantaAccount, recorded.id).expect(
        200,
      );

      expect(response.body).toEqual(recorded);
    });

    it.each([
      [
        'another customer’s operation through their own account',
        () => ({ as: fanta, account: fantaAccount, of: aliAccount }),
      ],
      [
        'another customer’s operation through its account',
        () => ({ as: fanta, account: aliAccount, of: aliAccount }),
      ],
      [
        'a staff member, through /me',
        () => ({ as: seller, account: fantaAccount, of: fantaAccount }),
      ],
    ])('answers 404 to %s', async (_, scenario) => {
      const { as, account, of } = scenario();
      const recorded = await deposit('5000', of);

      const response = await myReceipt(as, account, recorded.id).expect(404);

      expect(response.body.message).toBe('Opération introuvable');
    });

    it('answers 400 to a malformed operation id', async () => {
      const response = await myReceipt(
        fanta,
        fantaAccount,
        'not-a-uuid',
      ).expect(400);

      expect(response.body.message).toBe('Identifiant d’opération invalide');
    });
  });

  it('shows the goal balance in /me/accounts', async () => {
    await deposit('5000');

    const response = await api()
      .get('/api/v1/me/accounts')
      .set('Authorization', fanta.authorization)
      .expect(200);

    expect(response.body).toMatchObject([
      {
        id: fantaAccount,
        balance: '5000',
        goals: [{ label: 'Non affecté', balance: '5000' }],
      },
    ]);
  });
});
