import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { QR_CODE_PATTERN } from '../src/qr-codes/qr-code.js';
import { createTestApp } from './utils/app.js';
import { createMali, createStoreRecord } from './utils/countries.js';
import { resetDatabase } from './utils/reset-database.js';
import { signedInStaff, type MobileStaff } from './utils/staff.js';

describe('QR codes (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let customer: MobileStaff;
  let other: MobileStaff;
  let storeId: string;
  let otherStoreId: string;
  let manager: MobileStaff;
  let seller: MobileStaff;
  let outsider: MobileStaff;

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
  });

  beforeEach(async () => {
    await resetDatabase(prisma);
    await createMali(prisma);
    customer = await signedInStaff(app, prisma, { phone: '+22376445566' });
    other = await signedInStaff(app, prisma, { phone: '+22376112233' });
    storeId = (await createStoreRecord(prisma, { status: 'VERIFIED' })).id;
    otherStoreId = (await createStoreRecord(prisma, { status: 'VERIFIED' })).id;
    manager = await signedInStaff(app, prisma, {
      phone: '+22376000000',
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
  });

  afterAll(async () => {
    await app.close();
  });

  const api = () => request(app.getHttpServer());
  const myCode = (as = customer) =>
    api().get('/api/v1/me/qr-code').set('Authorization', as.authorization);
  const regenerate = (as = customer) =>
    api()
      .post('/api/v1/me/qr-code/regenerate')
      .set('Authorization', as.authorization);
  const storeCode = (as: MobileStaff = seller, store = storeId) =>
    api()
      .get(`/api/v1/stores/${store}/qr-code`)
      .set('Authorization', as.authorization);
  const regenerateStore = (as: MobileStaff = manager, store = storeId) =>
    api()
      .post(`/api/v1/stores/${store}/qr-code/regenerate`)
      .set('Authorization', as.authorization);
  const setStatus = (status: 'PENDING' | 'CLOSED') =>
    prisma.hardwareStore.update({ where: { id: storeId }, data: { status } });

  describe('GET /me/qr-code', () => {
    it('creates the code on first read, then gives the same one', async () => {
      const first = await myCode().expect(200);

      expect(first.body).toEqual({
        code: expect.stringMatching(QR_CODE_PATTERN),
      });
      expect((await myCode().expect(200)).body.code).toBe(first.body.code);
      expect(
        (
          await prisma.user.findUniqueOrThrow({
            where: { id: customer.userId },
          })
        ).qrCode,
      ).toBe(first.body.code);
    });

    it('agrees on one code when first reads run in parallel', async () => {
      const responses = await Promise.all([myCode(), myCode(), myCode()]);

      expect(responses.map((r) => r.status)).toEqual([200, 200, 200]);
      expect(new Set(responses.map((r) => r.body.code)).size).toBe(1);
    });

    it('gives each user their own code', async () => {
      const mine = (await myCode(customer).expect(200)).body.code;
      const theirs = (await myCode(other).expect(200)).body.code;

      expect(mine).not.toBe(theirs);
    });

    it('requires a session', async () => {
      await api().get('/api/v1/me/qr-code').expect(401);
    });
  });

  describe('POST /me/qr-code/regenerate', () => {
    it('replaces the code; later reads give the new one', async () => {
      const old = (await myCode().expect(200)).body.code as string;

      const response = await regenerate().expect(200);

      expect(response.body.code).toMatch(QR_CODE_PATTERN);
      expect(response.body.code).not.toBe(old);
      expect((await myCode().expect(200)).body.code).toBe(response.body.code);
    });

    it('works before any read, and leaves other users alone', async () => {
      const theirs = (await myCode(other).expect(200)).body.code;

      await regenerate(customer).expect(200);

      expect((await myCode(other).expect(200)).body.code).toBe(theirs);
    });

    it('requires a session', async () => {
      await api().post('/api/v1/me/qr-code/regenerate').expect(401);
    });
  });

  describe('GET /stores/:storeId/qr-code', () => {
    it('creates the store code on first read, the same for managers and sellers', async () => {
      const first = (await storeCode(seller).expect(200)).body.code as string;

      expect(first).toMatch(QR_CODE_PATTERN);
      expect((await storeCode(manager).expect(200)).body.code).toBe(first);
      // A store's code is not its staff's personal code.
      expect((await myCode(seller).expect(200)).body.code).not.toBe(first);
    });

    it('agrees on one code when first reads run in parallel', async () => {
      const responses = await Promise.all([
        storeCode(seller),
        storeCode(manager),
        storeCode(seller),
      ]);

      expect(new Set(responses.map((r) => r.body.code)).size).toBe(1);
    });

    it('works in a pending store and in a closed one (reading)', async () => {
      await setStatus('PENDING');
      await storeCode().expect(200);

      await setStatus('CLOSED');
      await storeCode().expect(200);
    });

    it('answers 404 to a member of another store', async () => {
      await storeCode(outsider)
        .expect(404)
        .expect((r) =>
          expect(r.body.message).toBe('Quincaillerie introuvable'),
        );
    });
  });

  describe('POST /stores/:storeId/qr-code/regenerate', () => {
    it('replaces the code and logs it without the code', async () => {
      const old = (await storeCode().expect(200)).body.code as string;

      const response = await regenerateStore().expect(200);

      expect(response.body.code).toMatch(QR_CODE_PATTERN);
      expect(response.body.code).not.toBe(old);
      expect((await storeCode().expect(200)).body.code).toBe(
        response.body.code,
      );
      const log = await prisma.activityLog.findFirstOrThrow({
        where: { action: 'STORE_QR_CODE_REGENERATED' },
      });
      expect(log).toMatchObject({
        storeId,
        userId: manager.userId,
        device: manager.deviceId,
        oldValue: null,
        newValue: null,
      });
      expect(JSON.stringify(log)).not.toContain(old);
      expect(JSON.stringify(log)).not.toContain(response.body.code);
    });

    it('lets two parallel regenerations both succeed, without a deadlock', async () => {
      const responses = await Promise.all([
        regenerateStore(),
        regenerateStore(),
      ]);

      expect(responses.map((r) => r.status)).toEqual([200, 200]);
      const final = (await storeCode().expect(200)).body.code;
      expect(responses.map((r) => r.body.code)).toContain(final);
      expect(
        await prisma.activityLog.count({
          where: { action: 'STORE_QR_CODE_REGENERATED' },
        }),
      ).toBe(2);
    });

    it('refuses a seller with 403 and a member of another store with 404', async () => {
      await regenerateStore(seller)
        .expect(403)
        .expect((r) => expect(r.body.error).toBe('STORE_ROLE_REQUIRED'));
      await regenerateStore(outsider).expect(404);
      expect(await prisma.activityLog.count()).toBe(0);
    });

    it('refuses a closed store with 409 STORE_CLOSED and keeps its code', async () => {
      const code = (await storeCode().expect(200)).body.code as string;
      await setStatus('CLOSED');

      await regenerateStore()
        .expect(409)
        .expect((r) => expect(r.body.error).toBe('STORE_CLOSED'));
      expect((await storeCode().expect(200)).body.code).toBe(code);
      expect(await prisma.activityLog.count()).toBe(0);
    });

    it('allows a pending store', async () => {
      await setStatus('PENDING');

      await regenerateStore().expect(200);
    });
  });
});
