import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { createAdmin } from './utils/admins.js';
import { accessCookieFor, createTestApp } from './utils/app.js';
import { createMali, createStoreRecord } from './utils/countries.js';
import { resetDatabase } from './utils/reset-database.js';
import { CapturingSmsSender } from './utils/sms.js';
import {
  createUser,
  newDeviceKey,
  TEST_PHONE,
  TEST_PIN,
} from './utils/users.js';

const DEVICE = 'device-0001-abcd';

interface Session {
  accessToken: string;
  refreshToken: string;
}

describe('Mobile sessions (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let userId: string;
  const sms = new CapturingSmsSender();
  const deviceKey = newDeviceKey();

  beforeAll(async () => {
    app = await createTestApp({ sms });
    prisma = app.get(PrismaService);
  });

  beforeEach(async () => {
    await resetDatabase(prisma);
    await createMali(prisma);
    const user = await createUser(prisma, { pin: TEST_PIN });
    userId = user.id;
    await prisma.userDevice.create({
      data: { userId, deviceId: DEVICE, publicKey: deviceKey.publicKey },
    });
  });

  afterAll(async () => {
    await app.close();
  });

  const api = () => request(app.getHttpServer());
  const bearer = (token: string) => `Bearer ${token}`;

  /** Signs in like the app: challenge, signature, PIN. */
  async function signIn(): Promise<Session> {
    const { challenge } = (
      await api()
        .post('/api/v1/auth/challenge')
        .send({ phone: TEST_PHONE, deviceId: DEVICE })
        .expect(200)
    ).body as { challenge: string };
    const response = await api()
      .post('/api/v1/auth/login')
      .send({
        phone: TEST_PHONE,
        pin: TEST_PIN,
        deviceId: DEVICE,
        challenge,
        signature: deviceKey.sign(challenge),
      })
      .expect(200);
    return response.body as Session;
  }
  const me = (authorization?: string) => {
    const call = api().get('/api/v1/me');
    return authorization ? call.set('Authorization', authorization) : call;
  };
  const refresh = (refreshToken: unknown) =>
    api().post('/api/v1/auth/refresh').send({ refreshToken });

  describe('GET /me', () => {
    it('returns the user and their active store memberships', async () => {
      const active = await createStoreRecord(prisma, {
        name: 'Quincaillerie A',
      });
      const left = await createStoreRecord(prisma, { name: 'Quincaillerie B' });
      await prisma.storeMember.createMany({
        data: [
          { userId, storeId: active.id, role: 'MANAGER' },
          { userId, storeId: left.id, role: 'SELLER', active: false },
        ],
      });
      const session = await signIn();

      const response = await me(bearer(session.accessToken)).expect(200);

      expect(response.body).toEqual({
        id: userId,
        firstName: 'Awa',
        lastName: 'Diallo',
        phone: TEST_PHONE,
        memberships: [
          {
            storeId: active.id,
            storeName: 'Quincaillerie A',
            role: 'MANAGER',
          },
        ],
      });
      // Never the PIN hash or the lockout state.
      expect(JSON.stringify(response.body)).not.toMatch(/pin|failed|locked/i);
    });

    it.each([
      ['no token', undefined],
      ['another scheme', 'Basic dXNlcjpwYXNz'],
      ['a malformed token', 'Bearer not.a.jwt'],
    ])('refuses %s with 401', async (_label, authorization) => {
      await me(authorization).expect(401);
    });
  });

  describe('the two populations never share a route', () => {
    it('refuses an admin cookie, or an admin token as Bearer, on mobile routes', async () => {
      await createAdmin(prisma, { email: 'awa@batisso.test' });
      const cookie = await accessCookieFor(app, 'awa@batisso.test');
      const adminToken = cookie.split('=')[1];

      await me().set('Cookie', cookie).expect(401);
      await me(bearer(adminToken)).expect(401);
    });

    it('refuses a mobile token on admin routes, as Bearer or in the admin cookie', async () => {
      const session = await signIn();

      await api()
        .get('/api/v1/admin/settings')
        .set('Authorization', bearer(session.accessToken))
        .expect(401);
      await api()
        .get('/api/v1/admin/settings')
        .set('Cookie', `batisso_admin_access=${session.accessToken}`)
        .expect(401);
    });
  });

  describe('POST /auth/refresh', () => {
    it('rotates: new tokens work, the old refresh token stops working', async () => {
      const first = await signIn();

      const response = await refresh(first.refreshToken).expect(200);

      const second = response.body as Session;
      expect(second.refreshToken).not.toBe(first.refreshToken);
      // Same session, new secret.
      expect(second.refreshToken.split('.')[0]).toBe(
        first.refreshToken.split('.')[0],
      );
      await me(bearer(second.accessToken)).expect(200);
      const reused = await refresh(first.refreshToken).expect(401);
      expect(reused.body).toMatchObject({
        error: 'INVALID_REFRESH_TOKEN',
        message: 'Session expirée, reconnectez-vous',
      });
      await refresh(second.refreshToken).expect(200);
    });

    it('lets only one of two parallel refreshes with the same token through', async () => {
      const session = await signIn();

      const statuses = (
        await Promise.all([
          refresh(session.refreshToken),
          refresh(session.refreshToken),
        ])
      )
        .map((r) => r.status)
        .sort((a, b) => a - b);

      expect(statuses).toEqual([200, 401]);
    });

    it.each([
      ['garbage', 'not-a-token'],
      ['an unknown session', '0192f0a4-7b1c-7c3e-9d2a-5e6f7a8b9c0d.secret'],
    ])('refuses %s', async (_label, token) => {
      await refresh(token).expect(401);
    });

    it('refuses a session that expired', async () => {
      const session = await signIn();
      await prisma.userSession.updateMany({
        data: { expiresAt: new Date(Date.now() - 1000) },
      });

      await refresh(session.refreshToken).expect(401);
      await me(bearer(session.accessToken)).expect(401);
    });

    it('refuses a missing refresh token with a French 400', async () => {
      const response = await refresh(undefined).expect(400);

      expect(response.body.details[0].field).toBe('refreshToken');
    });
  });

  describe('POST /auth/logout', () => {
    it('ends the session at once and keeps the device trusted', async () => {
      const session = await signIn();

      await api()
        .post('/api/v1/auth/logout')
        .set('Authorization', bearer(session.accessToken))
        .expect(204);

      // The access token is refused immediately, not when it expires.
      await me(bearer(session.accessToken)).expect(401);
      await refresh(session.refreshToken).expect(401);
      // PIN sign-in on the same device still works, without any SMS.
      const again = await signIn();
      await me(bearer(again.accessToken)).expect(200);
      expect(sms.messages).toEqual([]);
    });

    it('only ends the session it was called with', async () => {
      const phone = await signIn();
      const otherKey = newDeviceKey();
      await prisma.userDevice.create({
        data: {
          userId,
          deviceId: 'device-0002-efgh',
          publicKey: otherKey.publicKey,
        },
      });
      const { challenge } = (
        await api()
          .post('/api/v1/auth/challenge')
          .send({ phone: TEST_PHONE, deviceId: 'device-0002-efgh' })
          .expect(200)
      ).body as { challenge: string };
      const tablet = (
        await api()
          .post('/api/v1/auth/login')
          .send({
            phone: TEST_PHONE,
            pin: TEST_PIN,
            deviceId: 'device-0002-efgh',
            challenge,
            signature: otherKey.sign(challenge),
          })
          .expect(200)
      ).body as Session;

      await api()
        .post('/api/v1/auth/logout')
        .set('Authorization', bearer(phone.accessToken))
        .expect(204);

      await me(bearer(tablet.accessToken)).expect(200);
    });

    it('needs a mobile session', async () => {
      await api().post('/api/v1/auth/logout').expect(401);
    });
  });
});
