import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import type { PrismaService } from '../../src/prisma/prisma.service.js';
import { createUser, newDeviceKey, TEST_PIN } from './users.js';

export interface MobileStaff {
  userId: string;
  phone: string;
  deviceId: string;
  /** `Bearer <accessToken>` for the Authorization header. */
  authorization: string;
}

/**
 * A user with a PIN and a trusted device, signed in through the real mobile
 * flow (challenge signed by the device key, then the PIN), optionally a member
 * of a store with a role.
 */
export async function signedInStaff(
  app: INestApplication<App>,
  prisma: PrismaService,
  options: {
    phone: string;
    firstName?: string;
    store?: { id: string; role: 'MANAGER' | 'SELLER'; active?: boolean };
  },
): Promise<MobileStaff> {
  const user = await createUser(prisma, {
    phone: options.phone,
    pin: TEST_PIN,
    firstName: options.firstName,
  });
  if (options.store) {
    await prisma.storeMember.create({
      data: {
        userId: user.id,
        storeId: options.store.id,
        role: options.store.role,
        active: options.store.active ?? true,
      },
    });
  }
  const key = newDeviceKey();
  const deviceId = `device-${user.id.slice(-12)}`;
  await prisma.userDevice.create({
    data: { userId: user.id, deviceId, publicKey: key.publicKey },
  });

  const api = () => request(app.getHttpServer());
  const { challenge } = (
    await api()
      .post('/api/v1/auth/challenge')
      .send({ phone: options.phone, deviceId })
      .expect(200)
  ).body as { challenge: string };
  const session = await api()
    .post('/api/v1/auth/login')
    .send({
      phone: options.phone,
      pin: TEST_PIN,
      deviceId,
      challenge,
      signature: key.sign(challenge),
    })
    .expect(200);

  return {
    userId: user.id,
    phone: options.phone,
    deviceId,
    authorization: `Bearer ${(session.body as { accessToken: string }).accessToken}`,
  };
}
