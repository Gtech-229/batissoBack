import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { PERMISSION_NAMES } from '../src/admin-auth/permissions.js';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/configure-app.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import {
  WhatsappSendError,
  type GreenApiCredentials,
} from '../src/sms/green-api-client.js';
import { WHATSAPP_TEST_MESSAGE } from '../src/whatsapp-settings/dto/whatsapp-settings.dto.js';
import { TokenCipher } from '../src/whatsapp-settings/token-cipher.js';
import { createAdmin, TEST_PASSWORD } from './utils/admins.js';
import { accessCookieFor, createTestApp } from './utils/app.js';
import { createMali } from './utils/countries.js';
import { resetDatabase } from './utils/reset-database.js';

const INSTANCE = '7103123456';
const TOKEN = 'd75b3a66374942c5b3c019c698abc2067e151558acbd412345';
const OTHER_TOKEN = 'a0b1c2d3e4f5a6b7c8d9e0f1a2b3c4d5e6f7a8b9c0d1e2f3a4b5';

describe('WhatsApp settings (e2e, 25b and 25c)', () => {
  /** Stands in for Green API: records every call, or fails like it. */
  const greenApi = {
    calls: [] as {
      credentials: GreenApiCredentials;
      phone: string;
      text: string;
    }[],
    failure: null as Error | null,
    send(credentials: GreenApiCredentials, phone: string, text: string) {
      greenApi.calls.push({ credentials, phone, text });
      return greenApi.failure
        ? Promise.reject(greenApi.failure)
        : Promise.resolve();
    },
  };
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let superCookie: string;
  let superId: string;

  beforeAll(async () => {
    // The real key from .env.test; a fake Green API (no network).
    app = await createTestApp({
      greenApi: (...args) => greenApi.send(...args),
    });
    prisma = app.get(PrismaService);
  });

  beforeEach(async () => {
    await resetDatabase(prisma);
    greenApi.calls = [];
    greenApi.failure = null;
    const superAdmin = await createAdmin(prisma, {
      email: 'super@batisso.test',
      role: 'SUPER_ADMIN',
    });
    superId = superAdmin.id;
    superCookie = await accessCookieFor(app, 'super@batisso.test');
  });

  afterAll(async () => {
    await app.close();
  });

  const api = () => request(app.getHttpServer());
  const read = (cookie = superCookie) =>
    api().get('/api/v1/admin/whatsapp-settings').set('Cookie', cookie);
  const save = (body: Record<string, unknown>, cookie = superCookie) =>
    api()
      .patch('/api/v1/admin/whatsapp-settings')
      .set('Cookie', cookie)
      .send({ currentPassword: TEST_PASSWORD, ...body });

  describe('access', () => {
    it('refuses an ADMIN holding every permission (403), on both routes', async () => {
      await createAdmin(prisma, {
        email: 'admin@batisso.test',
        permissions: PERMISSION_NAMES,
      });
      const adminCookie = await accessCookieFor(app, 'admin@batisso.test');

      await read(adminCookie).expect(403);
      await save({ enabled: false }, adminCookie).expect(403);
    });

    it('refuses a request without a session (401)', async () => {
      await api().get('/api/v1/admin/whatsapp-settings').expect(401);
      await api()
        .patch('/api/v1/admin/whatsapp-settings')
        .send({ currentPassword: TEST_PASSWORD })
        .expect(401);
    });
  });

  it('shows the defaults before any save', async () => {
    const response = await read().expect(200);

    expect(response.body).toEqual({
      enabled: false,
      instanceId: null,
      tokenConfigured: false,
      tokenLast4: null,
      tokenReadable: false,
      encryptionAvailable: true,
      updatedAt: null,
      updatedBy: null,
    });
  });

  it('saves the credentials encrypted, never answering the token, and records the change', async () => {
    const response = await save({
      instanceId: INSTANCE,
      token: TOKEN,
      enabled: true,
    }).expect(200);

    expect(response.body).toMatchObject({
      enabled: true,
      instanceId: INSTANCE,
      tokenConfigured: true,
      tokenLast4: '2345',
      tokenReadable: true,
      encryptionAvailable: true,
      updatedBy: { id: superId, firstName: expect.any(String) as string },
    });
    expect(JSON.stringify(response.body)).not.toContain(TOKEN);
    expect(JSON.stringify((await read()).body)).not.toContain(TOKEN);

    // Stored encrypted: neither the token nor a part of it in the row.
    const [row] = await prisma.$queryRaw<{ tokenCiphertext: string }[]>`
      SELECT "tokenCiphertext" FROM "whatsapp_settings"`;
    expect(row.tokenCiphertext).toMatch(/^v1:/);
    expect(row.tokenCiphertext).not.toContain(TOKEN.slice(0, 12));
    expect(app.get(TokenCipher).decrypt(row.tokenCiphertext)).toBe(TOKEN);

    const [change] = await prisma.whatsappSettingsChange.findMany();
    expect(change).toMatchObject({
      adminId: superId,
      enabledBefore: false,
      enabledAfter: true,
      instanceIdBefore: null,
      instanceIdAfter: INSTANCE,
      tokenChanged: true,
      tokenLast4: '2345',
    });
    expect(JSON.stringify(change)).not.toContain(TOKEN);
    const alerts = await prisma.adminAlert.findMany();
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toMatchObject({
      type: 'WHATSAPP_SETTINGS_CHANGED',
      whatsappSettingsChangeId: change.id,
      storeId: null,
      accountId: null,
      resolvedAt: null,
    });
  });

  it('opens one alert per change, even while the previous one is open', async () => {
    await save({ instanceId: INSTANCE, token: TOKEN }).expect(200);
    await save({ enabled: true }).expect(200);
    await save({ token: OTHER_TOKEN }).expect(200);

    expect(await prisma.whatsappSettingsChange.count()).toBe(3);
    expect(
      await prisma.adminAlert.count({
        where: { type: 'WHATSAPP_SETTINGS_CHANGED', resolvedAt: null },
      }),
    ).toBe(3);
    const last = await prisma.whatsappSettingsChange.findFirstOrThrow({
      orderBy: { createdAt: 'desc' },
    });
    expect(last).toMatchObject({ tokenChanged: true, tokenLast4: 'a4b5' });
  });

  it('records nothing for a save that changes nothing', async () => {
    await save({ instanceId: INSTANCE, token: TOKEN }).expect(200);

    const same = await save({ instanceId: INSTANCE, token: TOKEN }).expect(200);
    await save({}).expect(200);

    expect(same.body).toMatchObject({
      instanceId: INSTANCE,
      tokenLast4: '2345',
    });
    expect(await prisma.whatsappSettingsChange.count()).toBe(1);
    expect(await prisma.adminAlert.count()).toBe(1);
  });

  it('lists the history newest first, without the token, super admin only', async () => {
    await save({ instanceId: INSTANCE, token: TOKEN }).expect(200);
    await save({ enabled: true }).expect(200);

    const response = await api()
      .get('/api/v1/admin/whatsapp-settings/changes?pageSize=1')
      .set('Cookie', superCookie)
      .expect(200);

    expect(response.body.total).toBe(2);
    expect(response.body.items).toHaveLength(1);
    expect(response.body.items[0]).toMatchObject({
      changedBy: { id: superId },
      enabledBefore: false,
      enabledAfter: true,
      instanceIdBefore: INSTANCE,
      instanceIdAfter: INSTANCE,
      tokenChanged: false,
      tokenLast4: '2345',
    });
    const all = await api()
      .get('/api/v1/admin/whatsapp-settings/changes')
      .set('Cookie', superCookie)
      .expect(200);
    expect(all.body.items[1]).toMatchObject({
      enabledAfter: false,
      instanceIdBefore: null,
      instanceIdAfter: INSTANCE,
      tokenChanged: true,
    });
    expect(JSON.stringify(all.body)).not.toContain(TOKEN);

    await createAdmin(prisma, {
      email: 'admin@batisso.test',
      permissions: PERMISSION_NAMES,
    });
    const adminCookie = await accessCookieFor(app, 'admin@batisso.test');
    await api()
      .get('/api/v1/admin/whatsapp-settings/changes')
      .set('Cookie', adminCookie)
      .expect(403);
  });

  it('shows the change in the admin alerts list, which can resolve it', async () => {
    await save({ instanceId: INSTANCE, token: TOKEN, enabled: true }).expect(
      200,
    );

    const listed = await api()
      .get('/api/v1/admin/alerts?type=WHATSAPP_SETTINGS_CHANGED')
      .set('Cookie', superCookie)
      .expect(200);

    expect(listed.body.total).toBe(1);
    const [alert] = listed.body.items;
    expect(alert).toMatchObject({
      type: 'WHATSAPP_SETTINGS_CHANGED',
      store: null,
      account: null,
      whatsappChange: {
        changedBy: { id: superId },
        enabledBefore: false,
        enabledAfter: true,
        instanceIdChanged: true,
        tokenChanged: true,
      },
    });
    expect(JSON.stringify(listed.body)).not.toContain(TOKEN);

    await api()
      .patch(`/api/v1/admin/alerts/${alert.id}/resolve`)
      .set('Cookie', superCookie)
      .expect(200);
  });

  it('records consistent changes when two saves arrive together (F-95)', async () => {
    // Without the lock, both would read the same state: two changes "from
    // nothing", the second one hiding the first.
    await Promise.all([
      save({ instanceId: '1111111111' }).expect(200),
      save({ instanceId: '2222222222' }).expect(200),
    ]);

    const changes = await prisma.whatsappSettingsChange.findMany({
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
    expect(changes).toHaveLength(2);
    expect(changes[0].instanceIdBefore).toBeNull();
    // The second one starts from what the first one saved.
    expect(changes[1].instanceIdBefore).toBe(changes[0].instanceIdAfter);
    const settings = await prisma.whatsappSettings.findUniqueOrThrow({
      where: { id: 1 },
    });
    expect(settings.instanceId).toBe(changes[1].instanceIdAfter);
  });

  it('keeps WhatsApp from staying on with an unreadable token, saying how to fix it (F-94)', async () => {
    await save({ instanceId: INSTANCE, token: TOKEN, enabled: true }).expect(
      200,
    );
    // The token as another key would leave it: still stored, unreadable.
    await prisma.whatsappSettings.update({
      where: { id: 1 },
      data: {
        tokenCiphertext: 'v1:AAAAAAAAAAAAAAAA:AAAAAAAAAAAAAAAAAAAAAA==:AAAA',
      },
    });

    const refused = await save({ instanceId: '9999999999' }).expect(409);

    expect(refused.body).toMatchObject({
      error: 'WHATSAPP_NOT_CONFIGURED',
      message:
        'WhatsApp ne peut pas être activé, ni rester activé, sans identifiant d’instance et jeton lisible : saisissez le jeton à nouveau, ou désactivez WhatsApp',
    });
    // Both ways out work: turning it off, or typing the token again.
    await save({ enabled: false }).expect(200);
    const fixed = await save({ token: TOKEN, enabled: true }).expect(200);
    expect(fixed.body).toMatchObject({ enabled: true, tokenReadable: true });
  });

  it('keeps WhatsApp alerts from an ADMIN who manages alerts: not listed, not resolvable', async () => {
    await save({ instanceId: INSTANCE, token: TOKEN }).expect(200);
    const [whatsappAlert] = await prisma.adminAlert.findMany();
    // Another alert, which the ADMIN does see.
    await prisma.adminAlert.create({ data: { type: 'CODE_LIMIT_REACHED' } });
    await createAdmin(prisma, {
      email: 'admin@batisso.test',
      permissions: ['alerts.read', 'alerts.manage'],
    });
    const adminCookie = await accessCookieFor(app, 'admin@batisso.test');

    const listed = await api()
      .get('/api/v1/admin/alerts?status=all')
      .set('Cookie', adminCookie)
      .expect(200);
    const filtered = await api()
      .get('/api/v1/admin/alerts?type=WHATSAPP_SETTINGS_CHANGED')
      .set('Cookie', adminCookie)
      .expect(200);
    await api()
      .patch(`/api/v1/admin/alerts/${whatsappAlert.id}/resolve`)
      .set('Cookie', adminCookie)
      .expect(404);

    expect(listed.body.total).toBe(1);
    expect(listed.body.items[0].type).toBe('CODE_LIMIT_REACHED');
    expect(filtered.body).toMatchObject({ total: 0, items: [] });
    expect(
      (
        await prisma.adminAlert.findUniqueOrThrow({
          where: { id: whatsappAlert.id },
        })
      ).resolvedAt,
    ).toBeNull();
    // The super admin still sees both.
    const superList = await api()
      .get('/api/v1/admin/alerts')
      .set('Cookie', superCookie)
      .expect(200);
    expect(superList.body.total).toBe(2);
  });

  describe('password re-confirmation', () => {
    it('refuses a wrong password (401), counts it, and saves nothing', async () => {
      const response = await save({
        currentPassword: 'Wrong#Pass1',
        instanceId: INSTANCE,
      }).expect(401);

      expect(response.body.error).toBe('INVALID_CREDENTIALS');
      const admin = await prisma.admin.findUniqueOrThrow({
        where: { id: superId },
      });
      expect(admin.failedLoginAttempts).toBe(1);
      expect(await prisma.whatsappSettings.count()).toBe(0);
      expect(await prisma.whatsappSettingsChange.count()).toBe(0);
    });

    it('locks the account at the login limit, then refuses even the right password (403)', async () => {
      for (let attempt = 1; attempt <= 5; attempt++) {
        await save({ currentPassword: 'Wrong#Pass1', enabled: false }).expect(
          401,
        );
      }

      const locked = await save({ instanceId: INSTANCE }).expect(403);

      expect(locked.body.error).toBe('ACCOUNT_LOCKED');
      expect(await prisma.whatsappSettings.count()).toBe(0);
    });
  });

  describe('refusals', () => {
    it('refuses enabling without both an instance and a token (409)', async () => {
      const response = await save({ enabled: true }).expect(409);
      await save({ enabled: true, instanceId: INSTANCE }).expect(409);

      expect(response.body.error).toBe('WHATSAPP_NOT_CONFIGURED');
      expect(await prisma.whatsappSettings.count()).toBe(0);
      expect(await prisma.adminAlert.count()).toBe(0);
    });

    it.each([
      ['an instance with letters', { instanceId: '71031abc' }, 'instanceId'],
      ['a 3-digit instance', { instanceId: '123' }, 'instanceId'],
      ['a short token', { token: 'abc123' }, 'token'],
      ['a token with symbols', { token: `${TOKEN.slice(0, 30)}-_!` }, 'token'],
      ['enabled as a string', { enabled: 'true' }, 'enabled'],
      ['a null token', { token: null }, 'token'],
      ['an unknown field', { baseUrl: 'https://evil.example' }, 'baseUrl'],
    ])(
      'refuses %s (400) without echoing the token',
      async (_label, body, field) => {
        const response = await save(body).expect(400);

        expect(JSON.stringify(response.body.details)).toContain(field);
        expect(JSON.stringify(response.body)).not.toContain(TOKEN.slice(0, 30));
      },
    );

    it('refuses a missing password (400)', async () => {
      await api()
        .patch('/api/v1/admin/whatsapp-settings')
        .set('Cookie', superCookie)
        .send({ enabled: false })
        .expect(400);
    });
  });

  describe('POST /admin/whatsapp-settings/test (25c)', () => {
    const sendTest = (body: Record<string, unknown>, cookie = superCookie) =>
      api()
        .post('/api/v1/admin/whatsapp-settings/test')
        .set('Cookie', cookie)
        .send(body);

    beforeEach(async () => {
      await createMali(prisma);
    });

    it('sends the test text with the saved credentials, even while WhatsApp is off', async () => {
      await save({ instanceId: INSTANCE, token: TOKEN }).expect(200);

      const response = await sendTest({ phone: '76 00 00 00' }).expect(200);

      expect(response.body).toEqual({ sent: true });
      expect(greenApi.calls).toEqual([
        {
          credentials: { instanceId: INSTANCE, token: TOKEN },
          phone: '+22376000000',
          text: WHATSAPP_TEST_MESSAGE,
        },
      ]);
      // Nothing recorded besides the save.
      expect(await prisma.whatsappSettingsChange.count()).toBe(1);
    });

    it('refuses without an instance and a readable token (409), sending nothing', async () => {
      const empty = await sendTest({ phone: '76 00 00 00' }).expect(409);
      await save({ instanceId: INSTANCE }).expect(200);
      await sendTest({ phone: '76 00 00 00' }).expect(409);

      expect(empty.body.error).toBe('WHATSAPP_NOT_CONFIGURED');
      expect(greenApi.calls).toHaveLength(0);
    });

    it.each([
      ['a number of another country', '+33 6 12 34 56 78'],
      ['letters', 'abc'],
      ['an empty phone', ''],
    ])('refuses %s (400)', async (_label, phone) => {
      await save({ instanceId: INSTANCE, token: TOKEN }).expect(200);

      await sendTest({ phone }).expect(400);

      expect(greenApi.calls).toHaveLength(0);
    });

    it('answers 502 with the cause when Green API fails, never the token', async () => {
      await save({ instanceId: INSTANCE, token: TOKEN }).expect(200);
      greenApi.failure = new WhatsappSendError('HTTP 466');

      const response = await sendTest({ phone: '76 00 00 00' }).expect(502);

      expect(response.body.error).toBe('WHATSAPP_SEND_FAILED');
      expect(response.body.message).toContain('HTTP 466');
      expect(JSON.stringify(response.body)).not.toContain(TOKEN);
    });

    it("is the super admin's only (403 for an ADMIN with every permission)", async () => {
      await save({ instanceId: INSTANCE, token: TOKEN }).expect(200);
      await createAdmin(prisma, {
        email: 'admin@batisso.test',
        permissions: PERMISSION_NAMES,
      });
      const adminCookie = await accessCookieFor(app, 'admin@batisso.test');

      await sendTest({ phone: '76 00 00 00' }, adminCookie).expect(403);

      expect(greenApi.calls).toHaveLength(0);
    });
  });

  describe('sending over WhatsApp (25c)', () => {
    beforeEach(async () => {
      await createMali(prisma);
    });

    it('sends a sign-in code over WhatsApp once it is on', async () => {
      await save({ instanceId: INSTANCE, token: TOKEN, enabled: true }).expect(
        200,
      );

      await api()
        .post('/api/v1/auth/code')
        .send({ phone: '76 00 00 00' })
        .expect(202);

      // The code is sent after the answer, without waiting.
      await vi.waitFor(() => {
        expect(greenApi.calls).toHaveLength(1);
      });
      expect(greenApi.calls[0]).toMatchObject({
        credentials: { instanceId: INSTANCE, token: TOKEN },
        phone: '+22376000000',
      });
      expect(greenApi.calls[0].text).toMatch(/\b\d{6}\b/);
    });

    it('goes the old way while WhatsApp is off', async () => {
      await save({ instanceId: INSTANCE, token: TOKEN }).expect(200);

      await api()
        .post('/api/v1/auth/code')
        .send({ phone: '76 00 00 00' })
        .expect(202);

      await new Promise((resolve) => setTimeout(resolve, 200));
      expect(greenApi.calls).toHaveLength(0);
    });
  });

  describe('without SETTINGS_ENCRYPTION_KEY', () => {
    let keyless: INestApplication<App>;
    let keylessCookie: string;

    beforeAll(async () => {
      const moduleRef = await Test.createTestingModule({
        imports: [AppModule],
      })
        .overrideProvider(TokenCipher)
        .useValue(new TokenCipher(undefined))
        .compile();
      keyless = moduleRef.createNestApplication<INestApplication<App>>();
      configureApp(keyless);
      await keyless.init();
    });

    beforeEach(async () => {
      keylessCookie = await accessCookieFor(keyless, 'super@batisso.test');
    });

    afterAll(async () => {
      await keyless.close();
    });

    it('reads as unavailable and refuses a token (409), saving nothing', async () => {
      const readResponse = await request(keyless.getHttpServer())
        .get('/api/v1/admin/whatsapp-settings')
        .set('Cookie', keylessCookie)
        .expect(200);
      const saveResponse = await request(keyless.getHttpServer())
        .patch('/api/v1/admin/whatsapp-settings')
        .set('Cookie', keylessCookie)
        .send({ currentPassword: TEST_PASSWORD, token: TOKEN })
        .expect(409);

      expect(readResponse.body.encryptionAvailable).toBe(false);
      expect(saveResponse.body.error).toBe('ENCRYPTION_KEY_MISSING');
      expect(await prisma.whatsappSettings.count()).toBe(0);
    });

    it('shows a token saved under another key as unreadable, and refuses enabling with it', async () => {
      await save({ instanceId: INSTANCE, token: TOKEN }).expect(200);

      const readResponse = await request(keyless.getHttpServer())
        .get('/api/v1/admin/whatsapp-settings')
        .set('Cookie', keylessCookie)
        .expect(200);
      expect(readResponse.body).toMatchObject({
        tokenConfigured: true,
        tokenReadable: false,
        tokenLast4: '2345',
      });
      await request(keyless.getHttpServer())
        .patch('/api/v1/admin/whatsapp-settings')
        .set('Cookie', keylessCookie)
        .send({ currentPassword: TEST_PASSWORD, enabled: true })
        .expect(409);
    });
  });
});
