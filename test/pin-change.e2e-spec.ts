import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { createTestApp } from './utils/app.js';
import { createMali } from './utils/countries.js';
import { resetDatabase } from './utils/reset-database.js';
import {
  createUser,
  newDeviceKey,
  TEST_PHONE,
  TEST_PIN,
} from './utils/users.js';

const NEW_PIN = '730164';
const PHONE_DEVICE = 'device-phone-0001';
const TABLET_DEVICE = 'device-tablet-0002';

interface Session {
  accessToken: string;
  refreshToken: string;
}

describe('PIN change (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let userId: string;
  const phoneKey = newDeviceKey();
  const tabletKey = newDeviceKey();

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
  });

  beforeEach(async () => {
    await resetDatabase(prisma);
    await createMali(prisma);
    userId = (await createUser(prisma, { pin: TEST_PIN })).id;
    await prisma.userDevice.createMany({
      data: [
        { userId, deviceId: PHONE_DEVICE, publicKey: phoneKey.publicKey },
        { userId, deviceId: TABLET_DEVICE, publicKey: tabletKey.publicKey },
      ],
    });
  });

  afterAll(async () => {
    await app.close();
  });

  const api = () => request(app.getHttpServer());

  async function attemptLogin(
    deviceId: string,
    key: ReturnType<typeof newDeviceKey>,
    pin: string,
  ) {
    const { challenge } = (
      await api()
        .post('/api/v1/auth/challenge')
        .send({ phone: TEST_PHONE, deviceId })
        .expect(200)
    ).body as { challenge: string };
    return api()
      .post('/api/v1/auth/login')
      .send({
        phone: TEST_PHONE,
        pin,
        deviceId,
        challenge,
        signature: key.sign(challenge),
      });
  }

  async function signIn(
    deviceId: string,
    key: ReturnType<typeof newDeviceKey>,
  ): Promise<Session> {
    return (
      await attemptLogin(deviceId, key, TEST_PIN).then((res) => {
        expect(res.status).toBe(200);
        return res;
      })
    ).body as Session;
  }

  const changePin = (session: Session, body: object) =>
    api()
      .put('/api/v1/me/pin')
      .set('Authorization', `Bearer ${session.accessToken}`)
      .send(body);

  it('changes the PIN: the old one stops working, the new one signs in', async () => {
    const session = await signIn(PHONE_DEVICE, phoneKey);

    await changePin(session, {
      currentPin: TEST_PIN,
      newPin: NEW_PIN,
    }).expect(204);

    const old = await attemptLogin(PHONE_DEVICE, phoneKey, TEST_PIN);
    expect(old.status).toBe(401);
    expect((old.body as { error: string }).error).toBe('INVALID_CREDENTIALS');
    const fresh = await attemptLogin(PHONE_DEVICE, phoneKey, NEW_PIN);
    expect(fresh.status).toBe(200);
  });

  it('closes the other sessions, keeps this one, and keeps the other device trusted', async () => {
    const session = await signIn(PHONE_DEVICE, phoneKey);
    const tablet = await signIn(TABLET_DEVICE, tabletKey);

    await changePin(session, {
      currentPin: TEST_PIN,
      newPin: NEW_PIN,
    }).expect(204);

    await api()
      .get('/api/v1/me')
      .set('Authorization', `Bearer ${session.accessToken}`)
      .expect(200);
    await api()
      .get('/api/v1/me')
      .set('Authorization', `Bearer ${tablet.accessToken}`)
      .expect(401);
    await api()
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: tablet.refreshToken })
      .expect(401);

    const again = await attemptLogin(TABLET_DEVICE, tabletKey, NEW_PIN);
    expect(again.status).toBe(200);
  });

  it('refuses a wrong current PIN and counts the attempt', async () => {
    const session = await signIn(PHONE_DEVICE, phoneKey);

    const res = await changePin(session, {
      currentPin: '111222',
      newPin: NEW_PIN,
    }).expect(400);

    expect((res.body as { error: string }).error).toBe('INVALID_PIN');
    const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    expect(user.failedPinAttempts).toBe(1);
    await attemptLogin(PHONE_DEVICE, phoneKey, TEST_PIN).then((login) =>
      expect(login.status).toBe(200),
    );
  });

  it('locks after too many wrong PINs, even with the right one', async () => {
    const session = await signIn(PHONE_DEVICE, phoneKey);
    await prisma.systemSettings.create({
      data: { maxLoginAttempts: 5, maxAdminSessions: 3, maxPinAttempts: 2 },
    });

    await changePin(session, { currentPin: '111222', newPin: NEW_PIN });
    await changePin(session, { currentPin: '111222', newPin: NEW_PIN });
    const res = await changePin(session, {
      currentPin: TEST_PIN,
      newPin: NEW_PIN,
    }).expect(403);

    expect((res.body as { error: string }).error).toBe('PIN_LOCKED');
  });

  it('refuses a weak new PIN with the field in the details', async () => {
    const session = await signIn(PHONE_DEVICE, phoneKey);

    const res = await changePin(session, {
      currentPin: TEST_PIN,
      newPin: '123456',
    }).expect(400);

    expect(JSON.stringify(res.body)).toContain('newPin');
  });

  it('refuses the same PIN without counting an attempt', async () => {
    const session = await signIn(PHONE_DEVICE, phoneKey);

    const res = await changePin(session, {
      currentPin: TEST_PIN,
      newPin: TEST_PIN,
    }).expect(400);

    expect((res.body as { error: string }).error).toBe('PIN_UNCHANGED');
    const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    expect(user.failedPinAttempts).toBe(0);
  });

  it('needs a session', async () => {
    await api()
      .put('/api/v1/me/pin')
      .send({ currentPin: TEST_PIN, newPin: NEW_PIN })
      .expect(401);
  });
});
