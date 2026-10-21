import type { INestApplication } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { createTestApp } from './utils/app.js';
import { createMali, createStoreRecord } from './utils/countries.js';
import { CapturingPushSender } from './utils/push.js';
import { resetDatabase } from './utils/reset-database.js';
import { CapturingSmsSender } from './utils/sms.js';
import { signedInStaff, type MobileStaff } from './utils/staff.js';

const BODY = (amount: string, balance: string, reference: string) =>
  `Dépôt de ${amount} XOF reçu par Quincaillerie du Carrefour sur votre compte ${accountNumber}. Nouveau solde : ${balance} XOF. Réf. ${reference}.`;
let accountNumber: string;

describe('Notifications (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  const sms = new CapturingSmsSender();
  const push = new CapturingPushSender();
  let storeId: string;
  let seller: MobileStaff;
  let customer: MobileStaff;
  let accountId: string;

  beforeAll(async () => {
    app = await createTestApp({ sms, push });
    prisma = app.get(PrismaService);
  });

  beforeEach(async () => {
    await resetDatabase(prisma);
    await createMali(prisma);
    storeId = (
      await createStoreRecord(prisma, {
        name: 'Quincaillerie du Carrefour',
        status: 'VERIFIED',
      })
    ).id;
    seller = await signedInStaff(app, prisma, {
      phone: '+22376000001',
      firstName: 'Moussa',
      store: { id: storeId, role: 'SELLER' },
    });
    // A customer who already uses the app (a PIN and a trusted device).
    customer = await signedInStaff(app, prisma, {
      phone: '+22376445566',
      firstName: 'Fanta',
    });
    const opened = await api()
      .post(`/api/v1/stores/${storeId}/accounts`)
      .set('Authorization', seller.authorization)
      .send({
        customer: { phone: customer.phone, firstName: 'Fanta', lastName: 'K' },
        termsAccepted: true,
      })
      .expect(201);
    accountId = opened.body.id as string;
    accountNumber = opened.body.number as string;
    sms.clear();
    push.clear();
  });

  afterAll(async () => {
    await app.close();
  });

  const api = () => request(app.getHttpServer());
  const deposit = (amount: string, key = randomUUID()) =>
    api()
      .post(`/api/v1/stores/${storeId}/accounts/${accountId}/deposits`)
      .set('Authorization', seller.authorization)
      .set('Idempotency-Key', key)
      .send({ amount });
  const setPushToken = (deviceId: string, pushToken: string | null) =>
    prisma.userDevice.updateMany({
      where: { deviceId },
      data: { pushToken },
    });
  const rows = () =>
    prisma.notification.findMany({ orderBy: [{ channel: 'asc' }] });
  /** The sends run after the answer: wait until none is PENDING. */
  const settled = async () => {
    for (let i = 0; i < 100; i++) {
      const pending = await prisma.notification.count({
        where: { status: 'PENDING' },
      });
      if (pending === 0) {
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    throw new Error('Notifications still PENDING');
  };

  describe('a deposit', () => {
    it('sends the customer an SMS, a push, and an in-app item, all SENT', async () => {
      await setPushToken(customer.deviceId, 'token-fanta-phone');

      const response = await deposit('5000').expect(201);
      await settled();

      const text = BODY('5 000', '5 000', response.body.reference as string);
      expect(sms.messages).toEqual([{ phone: customer.phone, text }]);
      expect(push.messages).toEqual([
        { token: 'token-fanta-phone', title: 'Dépôt reçu', body: text },
      ]);
      const device = await prisma.userDevice.findFirstOrThrow({
        where: { deviceId: customer.deviceId },
      });
      expect(await rows()).toMatchObject([
        {
          channel: 'APP',
          status: 'SENT',
          readAt: null,
          deviceId: null,
        },
        {
          channel: 'PUSH',
          status: 'SENT',
          attempts: 1,
          deviceId: device.id,
        },
        { channel: 'SMS', status: 'SENT', attempts: 1, lastError: null },
      ]);
      for (const row of await rows()) {
        expect(row).toMatchObject({
          userId: customer.userId,
          storeId,
          operationId: response.body.id,
          type: 'DEPOSIT_RECORDED',
          title: 'Dépôt reçu',
          body: text,
        });
        expect(row.sentAt).toBeInstanceOf(Date);
      }
    });

    it('pushes to every device with a token, and only to those', async () => {
      await setPushToken(customer.deviceId, 'token-phone-1');
      await prisma.userDevice.create({
        data: {
          userId: customer.userId,
          deviceId: 'second-phone',
          pushToken: 'token-phone-2',
        },
      });
      await prisma.userDevice.create({
        data: { userId: customer.userId, deviceId: 'tablet-no-push' },
      });

      await deposit('5000').expect(201);
      await settled();

      expect(push.messages.map((m) => m.token).sort()).toEqual([
        'token-phone-1',
        'token-phone-2',
      ]);
      expect(
        await prisma.notification.count({ where: { channel: 'PUSH' } }),
      ).toBe(2);
    });

    it('sends only the SMS and the in-app item to a customer without push', async () => {
      await deposit('5000').expect(201);
      await settled();

      expect(push.messages).toEqual([]);
      expect((await rows()).map((row) => row.channel)).toEqual(['APP', 'SMS']);
      expect(sms.messages).toHaveLength(1);
    });

    it('never notifies the staff member who recorded it', async () => {
      await setPushToken(seller.deviceId, 'token-seller');

      await deposit('5000').expect(201);
      await settled();

      expect(sms.messages.map((m) => m.phone)).toEqual([customer.phone]);
      expect(push.messages).toEqual([]);
      expect(
        await prisma.notification.count({ where: { userId: seller.userId } }),
      ).toBe(0);
    });

    it('records a failed send as FAILED, and the deposit still succeeds', async () => {
      await setPushToken(customer.deviceId, 'token-fanta-phone');
      sms.mode = 'reject';

      await deposit('5000').expect(201);
      await settled();

      const sent = await rows();
      expect(sent.find((row) => row.channel === 'SMS')).toMatchObject({
        status: 'FAILED',
        attempts: 1,
        lastError: 'Error',
        sentAt: null,
      });
      expect(sent.find((row) => row.channel === 'PUSH')?.status).toBe('SENT');
      expect(
        await prisma.account.findUniqueOrThrow({ where: { id: accountId } }),
      ).toMatchObject({ balance: 5000n });
    });

    it('answers at once even when the provider never answers', async () => {
      sms.mode = 'hang';

      const started = Date.now();
      await deposit('5000').expect(201);

      expect(Date.now() - started).toBeLessThan(2000);
      // The row stays PENDING for the retry job (feature 17).
      await new Promise((resolve) => setTimeout(resolve, 100));
      expect((await rows()).find((row) => row.channel === 'SMS')?.status).toBe(
        'PENDING',
      );
    });

    it('sends nothing more for a replayed deposit', async () => {
      const key = randomUUID();
      await deposit('5000', key).expect(201);
      await settled();

      await deposit('5000', key).expect(200);
      await settled();

      expect(sms.messages).toHaveLength(1);
      expect(await prisma.notification.count()).toBe(2);
    });

    it.each([
      ['below the minimum', '100'],
      ['over the maximum balance', '2000001'],
    ])('writes and sends nothing for a deposit %s', async (_, amount) => {
      await deposit(amount).expect(409);
      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(await prisma.notification.count()).toBe(0);
      expect(sms.messages).toEqual([]);
    });

    it('notifies each of several deposits separately', async () => {
      await deposit('5000').expect(201);
      await deposit('2500').expect(201);
      await settled();

      expect(sms.messages.map((m) => m.text)).toEqual([
        expect.stringContaining('Nouveau solde : 5 000 XOF'),
        expect.stringContaining('Nouveau solde : 7 500 XOF'),
      ]);
    });
  });

  describe('PUT /me/devices/push-token', () => {
    const putToken = (as: MobileStaff, body: Record<string, unknown>) =>
      api()
        .put('/api/v1/me/devices/push-token')
        .set('Authorization', as.authorization)
        .send(body);
    const tokenOf = async (deviceId: string) =>
      (
        await prisma.userDevice.findFirstOrThrow({
          where: { deviceId },
          select: { pushToken: true },
        })
      ).pushToken;

    it('stores the token on the session’s device only', async () => {
      await prisma.userDevice.create({
        data: { userId: customer.userId, deviceId: 'other-phone' },
      });

      await putToken(customer, { token: 'token-1' }).expect(204);

      expect(await tokenOf(customer.deviceId)).toBe('token-1');
      expect(await tokenOf('other-phone')).toBeNull();
    });

    it('replaces the token when the app sends a new one', async () => {
      await putToken(customer, { token: 'token-1' }).expect(204);
      await putToken(customer, { token: 'token-2' }).expect(204);

      expect(await tokenOf(customer.deviceId)).toBe('token-2');
    });

    it('takes a token off the previous user of the phone', async () => {
      await putToken(seller, { token: 'shared-phone' }).expect(204);

      await putToken(customer, { token: 'shared-phone' }).expect(204);

      expect(await tokenOf(seller.deviceId)).toBeNull();
      expect(await tokenOf(customer.deviceId)).toBe('shared-phone');
    });

    it('keeps one owner when two users claim a token at the same time', async () => {
      await Promise.all([
        putToken(seller, { token: 'contested' }).expect(204),
        putToken(customer, { token: 'contested' }).expect(204),
      ]);

      expect(
        await prisma.userDevice.count({ where: { pushToken: 'contested' } }),
      ).toBe(1);
    });

    it('turns push off with null', async () => {
      await putToken(customer, { token: 'token-1' }).expect(204);

      await putToken(customer, { token: null }).expect(204);

      expect(await tokenOf(customer.deviceId)).toBeNull();
    });

    it('pushes the next deposit to the registered device only', async () => {
      await putToken(customer, { token: 'token-1' }).expect(204);
      await putToken(seller, { token: 'token-seller' }).expect(204);

      await deposit('5000').expect(201);
      await settled();

      expect(push.messages.map((m) => m.token)).toEqual(['token-1']);
    });

    it('stops pushing after the token is removed', async () => {
      await putToken(customer, { token: 'token-1' }).expect(204);
      await putToken(customer, { token: null }).expect(204);

      await deposit('5000').expect(201);
      await settled();

      expect(push.messages).toEqual([]);
    });

    it.each([
      ['missing', {}],
      ['empty', { token: '' }],
      ['a number', { token: 42 }],
      ['too long', { token: 'x'.repeat(4097) }],
    ])('refuses a token that is %s with a French 400', async (_, body) => {
      const response = await putToken(customer, body).expect(400);

      expect(response.body.details).toEqual([
        {
          field: 'token',
          errors: [
            'Le jeton de notification doit être un texte de 1 à 4096 caractères, ou null',
          ],
        },
      ]);
    });

    it('answers 401 without a session', async () => {
      await api()
        .put('/api/v1/me/devices/push-token')
        .send({ token: 'token-1' })
        .expect(401);
    });
  });

  describe('the in-app list', () => {
    type Item = { id: string; body: string; read: boolean };
    const list = (as: MobileStaff, query: Record<string, number> = {}) =>
      api()
        .get('/api/v1/me/notifications')
        .query(query)
        .set('Authorization', as.authorization);
    const markRead = (as: MobileStaff, id: string) =>
      api()
        .patch(`/api/v1/me/notifications/${id}/read`)
        .set('Authorization', as.authorization);

    it('lists one item per deposit, newest first, with the unread count', async () => {
      await setPushToken(customer.deviceId, 'token-1');
      const first = await deposit('5000').expect(201);
      const second = await deposit('2500').expect(201);
      await settled();

      const response = await list(customer).expect(200);

      // One item per deposit: the SMS and push rows are delivery records.
      expect(response.body).toMatchObject({
        total: 2,
        page: 1,
        pageSize: 20,
        unreadCount: 2,
      });
      expect(response.body.items).toEqual([
        {
          id: expect.any(String),
          type: 'DEPOSIT_RECORDED',
          title: 'Dépôt reçu',
          body: expect.stringContaining('Nouveau solde : 7 500 XOF'),
          operationId: second.body.id,
          read: false,
          createdAt: expect.any(String),
        },
        expect.objectContaining({ operationId: first.body.id, read: false }),
      ]);
      // Never the delivery details.
      const json = JSON.stringify(response.body);
      for (const field of [
        'channel',
        'status',
        'attempts',
        'lastError',
        'token-1',
      ]) {
        expect(json).not.toContain(field);
      }
    });

    it('gives an empty list to a user with no notification', async () => {
      const response = await list(seller).expect(200);

      expect(response.body).toEqual({
        items: [],
        total: 0,
        page: 1,
        pageSize: 20,
        unreadCount: 0,
      });
    });

    it('pages the list; the unread count covers every page', async () => {
      await deposit('1000').expect(201);
      await deposit('1000').expect(201);
      await deposit('1000').expect(201);

      const response = await list(customer, { page: 2, pageSize: 2 }).expect(
        200,
      );

      expect(response.body).toMatchObject({
        total: 3,
        page: 2,
        pageSize: 2,
        unreadCount: 3,
      });
      expect(response.body.items).toHaveLength(1);
    });

    it('marks an item read, lowers the count, and is idempotent', async () => {
      await deposit('5000').expect(201);
      await deposit('2500').expect(201);
      const [newest] = (await list(customer).expect(200)).body.items as Item[];

      const read = await markRead(customer, newest.id).expect(200);
      expect(read.body).toMatchObject({ id: newest.id, read: true });
      const firstReadAt = (
        await prisma.notification.findUniqueOrThrow({
          where: { id: newest.id },
        })
      ).readAt;

      await markRead(customer, newest.id).expect(200);

      expect(
        (
          await prisma.notification.findUniqueOrThrow({
            where: { id: newest.id },
          })
        ).readAt,
      ).toEqual(firstReadAt);
      const after = await list(customer).expect(200);
      expect(after.body.unreadCount).toBe(1);
      expect((after.body.items as Item[]).map((item) => item.read)).toEqual([
        true,
        false,
      ]);
    });

    it('answers 404 to another user’s notification, and to a delivery row', async () => {
      await deposit('5000').expect(201);
      await settled();
      const [item] = (await list(customer).expect(200)).body.items as Item[];
      const smsRow = await prisma.notification.findFirstOrThrow({
        where: { channel: 'SMS' },
      });

      const response = await markRead(seller, item.id).expect(404);
      expect(response.body.message).toBe('Notification introuvable');
      // The SMS row of the same message is not an in-app item.
      await markRead(customer, smsRow.id).expect(404);
      expect(
        (
          await prisma.notification.findUniqueOrThrow({
            where: { id: item.id },
          })
        ).readAt,
      ).toBeNull();
    });

    it('answers 400 to a malformed id, 400 to bad paging, 401 without a session', async () => {
      await markRead(customer, 'not-a-uuid')
        .expect(400)
        .expect((r) =>
          expect(r.body.message).toBe('Identifiant de notification invalide'),
        );
      await list(customer, { page: 0 }).expect(400);
      await api().get('/api/v1/me/notifications').expect(401);
    });
  });
});
