import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { newQrCode } from '../src/qr-codes/qr-code.js';
import { createTestApp } from './utils/app.js';
import { createMali, createStoreRecord } from './utils/countries.js';
import { resetDatabase } from './utils/reset-database.js';
import { signedInStaff, type MobileStaff } from './utils/staff.js';

describe('QR code scans (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let storeId: string;
  let otherStoreId: string;
  let seller: MobileStaff;
  let manager: MobileStaff;
  let otherSeller: MobileStaff;
  let customer: MobileStaff;
  let stranger: MobileStaff;
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
    otherStoreId = (await createStoreRecord(prisma, { status: 'VERIFIED' })).id;
    seller = await signedInStaff(app, prisma, {
      phone: '+22376000001',
      store: { id: storeId, role: 'SELLER' },
    });
    manager = await signedInStaff(app, prisma, {
      phone: '+22376000000',
      store: { id: storeId, role: 'MANAGER' },
    });
    otherSeller = await signedInStaff(app, prisma, {
      phone: '+22376000002',
      store: { id: otherStoreId, role: 'SELLER' },
    });
    customer = await signedInStaff(app, prisma, { phone: '+22376445566' });
    stranger = await signedInStaff(app, prisma, { phone: '+22376112233' });
    // The customer has an account in both stores.
    accountId = await openAccount(seller, storeId, customer.phone);
    otherAccountId = await openAccount(
      otherSeller,
      otherStoreId,
      customer.phone,
    );
  });

  afterAll(async () => {
    await app.close();
  });

  const api = () => request(app.getHttpServer());
  const openAccount = async (as: MobileStaff, store: string, phone: string) =>
    (
      await api()
        .post(`/api/v1/stores/${store}/accounts`)
        .set('Authorization', as.authorization)
        .send({
          customer: { phone, firstName: 'Fanta', lastName: 'Keita' },
          termsAccepted: true,
        })
        .expect(201)
    ).body.id as string;
  const userCode = async (as: MobileStaff) =>
    (
      await api()
        .get('/api/v1/me/qr-code')
        .set('Authorization', as.authorization)
        .expect(200)
    ).body.code as string;
  const storeCode = async (as: MobileStaff, store: string) =>
    (
      await api()
        .get(`/api/v1/stores/${store}/qr-code`)
        .set('Authorization', as.authorization)
        .expect(200)
    ).body.code as string;
  const staffScan = (code: unknown, as = seller, store = storeId) =>
    api()
      .post(`/api/v1/stores/${store}/accounts/scan`)
      .set('Authorization', as.authorization)
      .send({ code });
  const customerScan = (code: unknown, as = customer) =>
    api()
      .post('/api/v1/me/accounts/scan')
      .set('Authorization', as.authorization)
      .send({ code });
  const NOT_FOUND = { statusCode: 404, message: 'Compte introuvable' };
  /**
   * Every unresolved scan must answer the very same body, so the answer tells
   * nothing about why: all fields equal except the time it was sent.
   */
  const expectIdenticalNotFound = (bodies: Record<string, unknown>[]) => {
    const withoutTime = bodies.map(({ timestamp, ...rest }) => {
      expect(typeof timestamp).toBe('string');
      return rest;
    });
    expect(withoutTime[0]).toMatchObject(NOT_FOUND);
    for (const body of withoutTime) {
      expect(body).toEqual(withoutTime[0]);
    }
  };

  describe('POST /stores/:storeId/accounts/scan', () => {
    it('gives the customer’s account detail in this store', async () => {
      const code = await userCode(customer);

      const response = await staffScan(code).expect(200);

      expect(response.body).toMatchObject({
        id: accountId,
        customer: { userId: customer.userId, phone: customer.phone },
        goals: [expect.objectContaining({ isSystem: true })],
        hasIdPhoto: false,
      });
      // The same view as the account detail route.
      const detail = await api()
        .get(`/api/v1/stores/${storeId}/accounts/${accountId}`)
        .set('Authorization', seller.authorization)
        .expect(200);
      expect(response.body).toEqual(detail.body);
    });

    it('resolves the same code to each store’s own account', async () => {
      const code = await userCode(customer);

      expect((await staffScan(code, manager).expect(200)).body.id).toBe(
        accountId,
      );
      expect(
        (await staffScan(code, otherSeller, otherStoreId).expect(200)).body.id,
      ).toBe(otherAccountId);
    });

    it('trims the scanned code', async () => {
      const code = await userCode(customer);

      await staffScan(`  ${code} `).expect(200);
    });

    it('gives the same 404 for an unknown code, a replaced one, a store code, and no account here', async () => {
      const replaced = await userCode(customer);
      await api()
        .post('/api/v1/me/qr-code/regenerate')
        .set('Authorization', customer.authorization)
        .expect(200);

      const bodies = [
        (await staffScan(newQrCode()).expect(404)).body,
        (await staffScan(replaced).expect(404)).body,
        (await staffScan(await storeCode(seller, storeId)).expect(404)).body,
        (await staffScan(await userCode(stranger)).expect(404)).body,
      ];

      expectIdenticalNotFound(bodies);
    });

    it.each([
      ['a short code', 'abc'],
      ['a code with other characters', `${'a'.repeat(31)}+`],
      ['a number', 12345],
      ['a missing code', undefined],
    ])('refuses %s with a French 400', async (_, code) => {
      const response = await staffScan(code).expect(400);

      expect(response.body.details).toContainEqual({
        field: 'code',
        errors: expect.arrayContaining(['Code QR invalide']),
      });
    });

    it('answers 404 to a member of another store, and 401 without a session', async () => {
      const code = await userCode(customer);

      await staffScan(code, otherSeller, storeId)
        .expect(404)
        .expect((r) =>
          expect(r.body.message).toBe('Quincaillerie introuvable'),
        );
      await api()
        .post(`/api/v1/stores/${storeId}/accounts/scan`)
        .send({ code })
        .expect(401);
    });
  });

  describe('POST /me/accounts/scan', () => {
    it('gives the customer’s own account in the scanned store', async () => {
      const response = await customerScan(
        await storeCode(seller, storeId),
      ).expect(200);

      expect(response.body).toMatchObject({
        id: accountId,
        store: { id: storeId },
      });
      // The same view as in GET /me/accounts.
      const mine = await api()
        .get('/api/v1/me/accounts')
        .set('Authorization', customer.authorization)
        .expect(200);
      expect(
        (mine.body as { id: string }[]).find((a) => a.id === accountId),
      ).toEqual(response.body);
    });

    it('resolves each store’s code to the right account', async () => {
      expect(
        (
          await customerScan(await storeCode(otherSeller, otherStoreId)).expect(
            200,
          )
        ).body.id,
      ).toBe(otherAccountId);
    });

    it('gives the same 404 for an unknown code, a replaced one, a user code, and no account there', async () => {
      const replaced = await storeCode(seller, storeId);
      await api()
        .post(`/api/v1/stores/${storeId}/qr-code/regenerate`)
        .set('Authorization', manager.authorization)
        .expect(200);
      const current = await storeCode(seller, storeId);

      const bodies = [
        (await customerScan(newQrCode()).expect(404)).body,
        (await customerScan(replaced).expect(404)).body,
        (await customerScan(await userCode(customer)).expect(404)).body,
        // Someone with no account in the store, staff included.
        (await customerScan(current, stranger).expect(404)).body,
        (await customerScan(current, seller).expect(404)).body,
      ];

      expectIdenticalNotFound(bodies);
    });

    it('refuses a malformed code with a French 400, and requires a session', async () => {
      const response = await customerScan('nope').expect(400);
      expect(response.body.details).toContainEqual({
        field: 'code',
        errors: ['Code QR invalide'],
      });

      await api()
        .post('/api/v1/me/accounts/scan')
        .send({ code: newQrCode() })
        .expect(401);
    });
  });
});
