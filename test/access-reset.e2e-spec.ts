import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { createTestApp } from './utils/app.js';
import { createMali, createStoreRecord } from './utils/countries.js';
import { resetDatabase } from './utils/reset-database.js';
import { CapturingSmsSender } from './utils/sms.js';
import { signedInStaff, type MobileStaff } from './utils/staff.js';
import { newDeviceKey, TEST_PIN, testPinHash } from './utils/users.js';

const NEW_PIN = '730164';
const NEW_DEVICE = 'device-new-phone-01';
const UNKNOWN_ID = '0192f0a4-7b1c-7c3e-9d2a-5e6f7a8b9c0d';

describe('Lost phone reset (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let storeId: string;
  let otherStoreId: string;
  let manager: MobileStaff;
  let seller: MobileStaff;
  let outsider: MobileStaff;
  let customer: MobileStaff;
  let accountId: string;
  const sms = new CapturingSmsSender();

  beforeAll(async () => {
    app = await createTestApp({ sms });
    prisma = app.get(PrismaService);
  });

  beforeEach(async () => {
    sms.messages = [];
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
    accountId = await openAccount(customer.phone);
  });

  afterAll(async () => {
    await app.close();
  });

  const api = () => request(app.getHttpServer());

  async function openAccount(
    phone: string,
    store = storeId,
    as = seller,
  ): Promise<string> {
    const res = await api()
      .post(`/api/v1/stores/${store}/accounts`)
      .set('Authorization', as.authorization)
      .send({
        customer: { phone, firstName: 'F', lastName: 'K' },
        termsAccepted: true,
      })
      .expect(201);
    return (res.body as { id: string }).id;
  }

  const reset = (account = accountId, as = manager, store = storeId) =>
    api()
      .post(`/api/v1/stores/${store}/accounts/${account}/access-reset`)
      .set('Authorization', as.authorization);

  const stored = () =>
    prisma.user.findUniqueOrThrow({
      where: { id: customer.userId },
      include: { devices: true, sessions: true },
    });

  /** The SMS of the reset has left: a later code is the holder's last SMS. */
  const notificationsSent = () =>
    vi.waitFor(
      async () => {
        const pending = await prisma.notification.count({
          where: { status: 'PENDING' },
        });
        expect(pending).toBe(0);
      },
      { timeout: 2000 },
    );

  const requestCode = () =>
    api().post('/api/v1/auth/code').send({ phone: customer.phone }).expect(202);

  const verifyCode = (code: string) =>
    api()
      .post('/api/v1/auth/code/verify')
      .send({ phone: customer.phone, code, deviceId: NEW_DEVICE });

  describe('POST .../accounts/:accountId/access-reset', () => {
    it('wipes the PIN, closes every session, and untrusts every device', async () => {
      await prisma.user.update({
        where: { id: customer.userId },
        data: { failedPinAttempts: 2 },
      });
      await prisma.userDevice.updateMany({
        where: { userId: customer.userId },
        data: { pushToken: 'push-token-of-the-lost-phone' },
      });

      const res = await reset().expect(200);

      expect(res.body).toEqual({
        firstName: 'Fanta',
        lastName: 'Diallo',
        resetAt: expect.any(String) as string,
        sessionsRevoked: 1,
        devicesUntrusted: 1,
      });
      const user = await stored();
      expect(user.pinHash).toBeNull();
      expect(user.failedPinAttempts).toBe(0);
      expect(user.sessions.every((s) => s.revokedAt !== null)).toBe(true);
      expect(user.devices).toHaveLength(1);
      expect(user.devices[0].publicKey).toBeNull();
      expect(user.devices[0].pushToken).toBeNull();
    });

    it('ends the old session on its next request', async () => {
      await api()
        .get('/api/v1/me')
        .set('Authorization', customer.authorization)
        .expect(200);

      await reset().expect(200);

      await api()
        .get('/api/v1/me')
        .set('Authorization', customer.authorization)
        .expect(401);
    });

    it('refuses the old device at sign-in', async () => {
      await reset().expect(200);

      const { challenge } = (
        await api()
          .post('/api/v1/auth/challenge')
          .send({ phone: customer.phone, deviceId: customer.deviceId })
          .expect(200)
      ).body as { challenge: string };
      const res = await api()
        .post('/api/v1/auth/login')
        .send({
          phone: customer.phone,
          pin: TEST_PIN,
          deviceId: customer.deviceId,
          challenge,
          signature: newDeviceKey().sign(challenge),
        })
        .expect(403);

      expect((res.body as { error: string }).error).toBe(
        'DEVICE_VERIFICATION_REQUIRED',
      );
    });

    it('lets the holder back in with an SMS code and a new PIN', async () => {
      await reset().expect(200);
      await notificationsSent();

      await requestCode();
      const verified = await verifyCode(sms.lastCodeFor(customer.phone)).expect(
        200,
      );
      const { verificationToken, pinSet } = verified.body as {
        verificationToken: string;
        pinSet: boolean;
      };
      expect(pinSet).toBe(false);

      const session = await api()
        .post('/api/v1/auth/pin')
        .send({
          verificationToken,
          pin: NEW_PIN,
          publicKey: newDeviceKey().publicKey,
          deviceName: 'Nouveau téléphone',
        })
        .expect(200);

      await api()
        .get('/api/v1/me')
        .set(
          'Authorization',
          `Bearer ${(session.body as { accessToken: string }).accessToken}`,
        )
        .expect(200);
      expect((await stored()).pinHash).not.toBeNull();
    });

    it('retires a live SMS code and a verification token in flight', async () => {
      await requestCode();
      const code = sms.lastCodeFor(customer.phone);
      const verified = await verifyCode(code).expect(200);
      const { verificationToken } = verified.body as {
        verificationToken: string;
      };

      await reset().expect(200);

      await api()
        .post('/api/v1/auth/pin')
        .send({
          verificationToken,
          pin: NEW_PIN,
          publicKey: newDeviceKey().publicKey,
        })
        .expect(401);
      expect((await stored()).pinHash).toBeNull();
    });

    it('tells the person in-app and by SMS, never by push', async () => {
      await prisma.userDevice.updateMany({
        where: { userId: customer.userId },
        data: { pushToken: 'push-token-of-the-lost-phone' },
      });

      await reset().expect(200);
      await notificationsSent();

      const rows = await prisma.notification.findMany({
        where: { userId: customer.userId, type: 'ACCESS_RESET' },
        orderBy: { channel: 'asc' },
      });
      expect(rows.map((row) => row.channel).sort()).toEqual(['APP', 'SMS']);
      expect(rows[0].storeId).toBe(storeId);
      expect(
        sms.messages.some(
          (m) =>
            m.phone === customer.phone && m.text.includes('nouveau code PIN'),
        ),
      ).toBe(true);
    });

    it('writes one activity row, without the phone or any secret', async () => {
      await reset().expect(200);

      const logs = await prisma.activityLog.findMany({
        where: { storeId, action: 'ACCESS_RESET' },
      });
      expect(logs).toHaveLength(1);
      expect(logs[0].userId).toBe(manager.userId);
      expect(logs[0].device).toBe(manager.deviceId);
      expect(logs[0].newValue).toEqual({
        targetUserId: customer.userId,
        sessionsRevoked: 1,
        devicesUntrusted: 1,
        securityQuestionsCleared: false,
      });
    });

    it('never returns the phone', async () => {
      const res = await reset().expect(200);

      expect(JSON.stringify(res.body)).not.toContain(customer.phone);
    });

    it('works in any store status', async () => {
      await prisma.hardwareStore.update({
        where: { id: storeId },
        data: { status: 'SUSPENDED' },
      });

      await reset().expect(200);
    });

    it('refuses someone who manages a store, and changes nothing', async () => {
      const managerAccount = await openAccount(outsider.phone);

      const res = await reset(managerAccount).expect(403);

      expect((res.body as { error: string }).error).toBe(
        'MANAGER_RESET_NOT_ALLOWED',
      );
      const target = await prisma.user.findUniqueOrThrow({
        where: { id: outsider.userId },
      });
      expect(target.pinHash).not.toBeNull();
      await api()
        .get('/api/v1/me')
        .set('Authorization', outsider.authorization)
        .expect(200);
      expect(
        await prisma.activityLog.count({ where: { action: 'ACCESS_RESET' } }),
      ).toBe(0);
    });

    it('allows a person who only used to manage a store', async () => {
      await prisma.storeMember.create({
        data: {
          userId: customer.userId,
          storeId: otherStoreId,
          role: 'MANAGER',
          active: false,
        },
      });

      await reset().expect(200);
    });

    it('refuses a seller of the store', async () => {
      const res = await reset(accountId, seller).expect(403);

      expect((res.body as { error: string }).error).toBe('STORE_ROLE_REQUIRED');
      expect((await stored()).pinHash).not.toBeNull();
    });

    it('answers 404 to a manager of another store', async () => {
      await reset(accountId, outsider).expect(404);

      expect((await stored()).pinHash).not.toBeNull();
    });

    it('answers 404 for an account of another store', async () => {
      const elsewhere = await openAccount(
        customer.phone,
        otherStoreId,
        outsider,
      );

      await reset(elsewhere).expect(404);

      expect((await stored()).pinHash).not.toBeNull();
    });

    it('answers 404 for an unknown account and 400 for a bad id', async () => {
      await reset(UNKNOWN_ID).expect(404);
      await reset('not-a-uuid').expect(400);
    });

    it('needs a session', async () => {
      await api()
        .post(`/api/v1/stores/${storeId}/accounts/${accountId}/access-reset`)
        .expect(401);
    });
  });

  describe('POST .../sellers/:userId/access-reset', () => {
    const resetSeller = (userId: string, as = manager) =>
      api()
        .post(`/api/v1/stores/${storeId}/sellers/${userId}/access-reset`)
        .set('Authorization', as.authorization);

    const pinOf = async (userId: string) =>
      (await prisma.user.findUniqueOrThrow({ where: { id: userId } })).pinHash;

    it('resets a seller of the store', async () => {
      const res = await resetSeller(seller.userId).expect(200);

      expect((res.body as { firstName: string }).firstName).toBe('Moussa');
      expect(await pinOf(seller.userId)).toBeNull();
      await api()
        .get('/api/v1/me')
        .set('Authorization', seller.authorization)
        .expect(401);
      const log = await prisma.activityLog.findFirstOrThrow({
        where: { action: 'ACCESS_RESET' },
      });
      expect(log.newValue).toMatchObject({ targetUserId: seller.userId });
    });

    it('resets an inactive seller', async () => {
      await prisma.storeMember.updateMany({
        where: { userId: seller.userId },
        data: { active: false },
      });

      await resetSeller(seller.userId).expect(200);

      expect(await pinOf(seller.userId)).toBeNull();
    });

    it('refuses a manager, themselves included', async () => {
      const res = await resetSeller(manager.userId).expect(403);

      expect((res.body as { error: string }).error).toBe(
        'MANAGER_RESET_NOT_ALLOWED',
      );
      expect(await pinOf(manager.userId)).not.toBeNull();
    });

    it('refuses a seller who manages another store', async () => {
      await prisma.storeMember.create({
        data: { userId: seller.userId, storeId: otherStoreId, role: 'MANAGER' },
      });

      await resetSeller(seller.userId).expect(403);

      expect(await pinOf(seller.userId)).not.toBeNull();
    });

    it('answers 404 for a seller of another store and a customer', async () => {
      const elsewhere = await signedInStaff(app, prisma, {
        phone: '+22376000003',
        store: { id: otherStoreId, role: 'SELLER' },
      });

      await resetSeller(elsewhere.userId).expect(404);
      await resetSeller(customer.userId).expect(404);

      expect(await pinOf(elsewhere.userId)).not.toBeNull();
      expect(await pinOf(customer.userId)).not.toBeNull();
    });

    it('answers 400 for a bad id, and refuses a seller as the author', async () => {
      await resetSeller('not-a-uuid').expect(400);
      await resetSeller(seller.userId, seller).expect(403);
    });
  });

  describe('races', () => {
    const key = newDeviceKey();

    /** Gives the customer a PIN and a device key this test can sign with. */
    async function restoreCustomer() {
      await prisma.user.update({
        where: { id: customer.userId },
        data: { pinHash: await testPinHash(TEST_PIN) },
      });
      await prisma.userDevice.updateMany({
        where: { userId: customer.userId },
        data: { publicKey: key.publicKey },
      });
    }

    async function login() {
      const { challenge } = (
        await api()
          .post('/api/v1/auth/challenge')
          .send({ phone: customer.phone, deviceId: customer.deviceId })
          .expect(200)
      ).body as { challenge: string };
      return api()
        .post('/api/v1/auth/login')
        .send({
          phone: customer.phone,
          pin: TEST_PIN,
          deviceId: customer.deviceId,
          challenge,
          signature: key.sign(challenge),
        });
    }

    const liveSessions = () =>
      prisma.userSession.count({
        where: { userId: customer.userId, revokedAt: null },
      });

    it('leaves no live session when a login races a reset', async () => {
      for (let round = 0; round < 6; round += 1) {
        await restoreCustomer();

        const [signIn] = await Promise.all([
          login(),
          reset().then((res) => expect(res.status).toBe(200)),
        ]);

        expect([200, 401, 403]).toContain(signIn.status);
        expect(await liveSessions()).toBe(0);
        expect((await stored()).pinHash).toBeNull();
      }
    });

    it('does not let a PIN change bring a PIN back after a reset', async () => {
      for (let round = 0; round < 6; round += 1) {
        await restoreCustomer();
        const session = await login();
        expect(session.status).toBe(200);
        const { accessToken } = session.body as { accessToken: string };

        const [change] = await Promise.all([
          api()
            .put('/api/v1/me/pin')
            .set('Authorization', `Bearer ${accessToken}`)
            .send({ currentPin: TEST_PIN, newPin: NEW_PIN })
            .then((res) => res),
          reset().then((res) => expect(res.status).toBe(200)),
        ]);

        expect([204, 400, 401]).toContain(change.status);
        expect((await stored()).pinHash).toBeNull();
        expect(await liveSessions()).toBe(0);
      }
    });
  });
});
