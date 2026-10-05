import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types.js';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/configure-app.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { SystemSettingsService } from '../src/system-settings/system-settings.service.js';
import { cookiesFrom, createAdmin, TEST_PASSWORD } from './utils/admins.js';
import { resetDatabase } from './utils/reset-database.js';

const ACCESS = 'batisso_admin_access';
const REFRESH = 'batisso_admin_refresh';

describe('Admin authentication (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();
    prisma = app.get(PrismaService);
  });

  beforeEach(async () => {
    await resetDatabase(prisma);
  });

  afterAll(async () => {
    await app.close();
  });

  function login(email: string, password: string, userAgent = 'vitest') {
    return request(app.getHttpServer())
      .post('/api/v1/admin/auth/login')
      .set('User-Agent', userAgent)
      .send({ email, password });
  }

  async function loginCookies(email: string) {
    const response = await login(email, TEST_PASSWORD).expect(200);
    return cookiesFrom(response.headers['set-cookie']);
  }

  describe('POST /admin/auth/login', () => {
    it('opens a session, sets httpOnly cookies, and returns only the profile', async () => {
      const admin = await createAdmin(prisma, { email: 'awa@batisso.test' });

      const response = await login('  AWA@Batisso.test ', TEST_PASSWORD).expect(
        200,
      );

      expect(response.body).toEqual({
        id: admin.id,
        email: 'awa@batisso.test',
        firstName: 'Awa',
        lastName: 'Diallo',
        role: 'ADMIN',
        mustChangePassword: false,
      });
      const cookies = cookiesFrom(response.headers['set-cookie']);
      const access = cookies.get(ACCESS)!.header;
      const refresh = cookies.get(REFRESH)!.header;
      expect(access).toMatch(/HttpOnly/);
      expect(access).toMatch(/SameSite=Lax/);
      expect(access).toMatch(/Path=\/api\/v1;/);
      expect(access).toMatch(/Max-Age=900/);
      expect(refresh).toMatch(/HttpOnly/);
      expect(refresh).toMatch(/Path=\/api\/v1\/admin\/auth/);
      expect(refresh).toMatch(/Max-Age=604800/);
      // Not production: no Secure flag, so cookies work over http://localhost.
      expect(access).not.toMatch(/Secure/);

      const sessions = await prisma.adminSession.findMany();
      expect(sessions).toHaveLength(1);
      expect(sessions[0].userAgent).toBe('vitest');
      // Only the hash is stored, never the cookie value.
      expect(cookies.get(REFRESH)!.pair).not.toContain(
        sessions[0].refreshTokenHash,
      );
    });

    it('answers the same way for a wrong password and an unknown email', async () => {
      await createAdmin(prisma, { email: 'awa@batisso.test' });

      const wrong = await login('awa@batisso.test', 'Wrong#Pass1').expect(401);
      const unknown = await login('nobody@batisso.test', TEST_PASSWORD).expect(
        401,
      );

      for (const response of [wrong, unknown]) {
        expect(response.body).toMatchObject({
          error: 'INVALID_CREDENTIALS',
          message: 'Email ou mot de passe incorrect',
        });
        expect(response.headers['set-cookie']).toBeUndefined();
      }
    });

    it('locks the account after the configured attempts, even for the right password', async () => {
      const admin = await createAdmin(prisma, { email: 'awa@batisso.test' });

      for (let attempt = 1; attempt <= 5; attempt++) {
        await login('awa@batisso.test', 'Wrong#Pass1').expect(401);
      }
      const locked = await login('awa@batisso.test', TEST_PASSWORD).expect(403);

      expect(locked.body.error).toBe('ACCOUNT_LOCKED');
      expect(locked.body.message).toMatch(
        /^Compte temporairement bloqué\. Réessayez dans 1[45] minutes\.$/,
      );
      const stored = await prisma.admin.findUniqueOrThrow({
        where: { id: admin.id },
      });
      expect(stored.failedLoginAttempts).toBe(0);
      expect(stored.lockedUntil!.getTime()).toBeGreaterThan(Date.now());
    });

    it('counts parallel wrong passwords one by one: at most maxLoginAttempts 401s (F-01)', async () => {
      const admin = await createAdmin(prisma, { email: 'awa@batisso.test' });

      const responses = await Promise.all(
        Array.from({ length: 20 }, () =>
          login('awa@batisso.test', 'Wrong#Pass1'),
        ),
      );

      const errors = responses.map((r) => r.body.error as string);
      expect(errors.filter((e) => e === 'INVALID_CREDENTIALS')).toHaveLength(5);
      expect(errors.filter((e) => e === 'ACCOUNT_LOCKED')).toHaveLength(15);
      const stored = await prisma.admin.findUniqueOrThrow({
        where: { id: admin.id },
      });
      expect(stored.lockedUntil!.getTime()).toBeGreaterThan(Date.now());
    });

    it('refuses the right password sent in parallel once the lock is set (F-01)', async () => {
      await createAdmin(prisma, { email: 'awa@batisso.test' });
      await Promise.all(
        Array.from({ length: 10 }, () =>
          login('awa@batisso.test', 'Wrong#Pass1'),
        ),
      );

      const responses = await Promise.all(
        Array.from({ length: 5 }, () =>
          login('awa@batisso.test', TEST_PASSWORD),
        ),
      );

      expect(responses.map((r) => r.status)).toEqual([403, 403, 403, 403, 403]);
      expect(await prisma.adminSession.count()).toBe(0);
    });

    it('lets the admin in again once the lock has passed', async () => {
      const admin = await createAdmin(prisma, {
        email: 'awa@batisso.test',
        lockedUntil: new Date(Date.now() - 1000),
        failedLoginAttempts: 2,
      });

      await login('awa@batisso.test', TEST_PASSWORD).expect(200);

      const stored = await prisma.admin.findUniqueOrThrow({
        where: { id: admin.id },
      });
      expect(stored.lockedUntil).toBeNull();
      expect(stored.failedLoginAttempts).toBe(0);
    });

    it('uses maxLoginAttempts from the system settings', async () => {
      const admin = await createAdmin(prisma, { email: 'awa@batisso.test' });
      await app
        .get(SystemSettingsService)
        .update({ maxLoginAttempts: 3 }, admin.id);

      for (let attempt = 1; attempt <= 3; attempt++) {
        await login('awa@batisso.test', 'Wrong#Pass1').expect(401);
      }

      await login('awa@batisso.test', TEST_PASSWORD).expect(403);
    });

    it('refuses a deactivated admin only when the password is right', async () => {
      await createAdmin(prisma, {
        email: 'awa@batisso.test',
        isActive: false,
      });

      const right = await login('awa@batisso.test', TEST_PASSWORD).expect(403);
      expect(right.body.error).toBe('ACCOUNT_DISABLED');

      const wrong = await login('awa@batisso.test', 'Wrong#Pass1').expect(401);
      expect(wrong.body.error).toBe('INVALID_CREDENTIALS');
    });

    it('revokes the oldest sessions beyond maxAdminSessions', async () => {
      const admin = await createAdmin(prisma, { email: 'awa@batisso.test' });
      await app
        .get(SystemSettingsService)
        .update({ maxAdminSessions: 2 }, admin.id);

      for (const browser of ['first', 'second', 'third']) {
        await login('awa@batisso.test', TEST_PASSWORD, browser).expect(200);
      }

      const sessions = await prisma.adminSession.findMany({
        orderBy: { createdAt: 'asc' },
      });
      expect(sessions.map((s) => [s.userAgent, s.revokedAt !== null])).toEqual([
        ['first', true],
        ['second', false],
        ['third', false],
      ]);
    });

    it('rejects an invalid email with French validation details', async () => {
      const response = await login('not-an-email', TEST_PASSWORD).expect(400);

      expect(response.body.details).toEqual([
        { field: 'email', errors: ['L’adresse email est invalide'] },
      ]);
    });
  });

  describe('POST /admin/auth/refresh', () => {
    it('rotates the session: new cookies, and the old refresh token stops working', async () => {
      await createAdmin(prisma, { email: 'awa@batisso.test' });
      const first = await loginCookies('awa@batisso.test');

      const refreshed = await request(app.getHttpServer())
        .post('/api/v1/admin/auth/refresh')
        .set('Cookie', first.get(REFRESH)!.pair)
        .expect(204);
      const second = cookiesFrom(refreshed.headers['set-cookie']);
      expect(second.get(REFRESH)!.pair).not.toBe(first.get(REFRESH)!.pair);
      expect(second.get(ACCESS)).toBeDefined();

      const replay = await request(app.getHttpServer())
        .post('/api/v1/admin/auth/refresh')
        .set('Cookie', first.get(REFRESH)!.pair)
        .expect(401);
      expect(replay.body.error).toBe('INVALID_REFRESH_TOKEN');
      // The dead cookies are cleared.
      expect(
        cookiesFrom(replay.headers['set-cookie']).get(REFRESH)!.header,
      ).toMatch(/Expires=Thu, 01 Jan 1970/);

      await request(app.getHttpServer())
        .post('/api/v1/admin/auth/refresh')
        .set('Cookie', second.get(REFRESH)!.pair)
        .expect(204);
    });

    it('refuses a missing cookie', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/v1/admin/auth/refresh')
        .expect(401);

      expect(response.body.error).toBe('INVALID_REFRESH_TOKEN');
    });

    it('refuses an expired session', async () => {
      await createAdmin(prisma, { email: 'awa@batisso.test' });
      const cookies = await loginCookies('awa@batisso.test');
      await prisma.adminSession.updateMany({
        data: { expiresAt: new Date(Date.now() - 1000) },
      });

      await request(app.getHttpServer())
        .post('/api/v1/admin/auth/refresh')
        .set('Cookie', cookies.get(REFRESH)!.pair)
        .expect(401);
    });

    it('refuses the session of an admin deactivated since login', async () => {
      const admin = await createAdmin(prisma, { email: 'awa@batisso.test' });
      const cookies = await loginCookies('awa@batisso.test');
      await prisma.admin.update({
        where: { id: admin.id },
        data: { isActive: false },
      });

      await request(app.getHttpServer())
        .post('/api/v1/admin/auth/refresh')
        .set('Cookie', cookies.get(REFRESH)!.pair)
        .expect(401);
    });
  });

  describe('POST /admin/auth/logout', () => {
    it('revokes the session and clears the cookies', async () => {
      await createAdmin(prisma, { email: 'awa@batisso.test' });
      const cookies = await loginCookies('awa@batisso.test');

      const response = await request(app.getHttpServer())
        .post('/api/v1/admin/auth/logout')
        .set('Cookie', cookies.get(REFRESH)!.pair)
        .expect(204);

      expect(
        cookiesFrom(response.headers['set-cookie']).get(ACCESS)!.header,
      ).toMatch(/Expires=Thu, 01 Jan 1970/);
      const [session] = await prisma.adminSession.findMany();
      expect(session.revokedAt).not.toBeNull();

      await request(app.getHttpServer())
        .post('/api/v1/admin/auth/refresh')
        .set('Cookie', cookies.get(REFRESH)!.pair)
        .expect(401);
    });

    it('answers 204 without a session', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/admin/auth/logout')
        .expect(204);
    });
  });

  describe('GET /admin/auth/me and the guard', () => {
    it('refuses a request without the access cookie, in French', async () => {
      const response = await request(app.getHttpServer())
        .get('/api/v1/admin/auth/me')
        .expect(401);

      expect(response.body).toMatchObject({
        error: 'UNAUTHORIZED',
        message: 'Authentification requise',
      });
    });

    it('returns the profile of the logged-in admin', async () => {
      const admin = await createAdmin(prisma, { email: 'awa@batisso.test' });
      const cookies = await loginCookies('awa@batisso.test');

      const response = await request(app.getHttpServer())
        .get('/api/v1/admin/auth/me')
        .set('Cookie', cookies.get(ACCESS)!.pair)
        .expect(200);

      expect(response.body).toMatchObject({ id: admin.id, role: 'ADMIN' });
    });

    it('refuses the access token right after logout', async () => {
      await createAdmin(prisma, { email: 'awa@batisso.test' });
      const cookies = await loginCookies('awa@batisso.test');
      await request(app.getHttpServer())
        .post('/api/v1/admin/auth/logout')
        .set('Cookie', cookies.get(REFRESH)!.pair)
        .expect(204);

      await request(app.getHttpServer())
        .get('/api/v1/admin/auth/me')
        .set('Cookie', cookies.get(ACCESS)!.pair)
        .expect(401);
    });

    it('refuses an open session as soon as the admin is deactivated', async () => {
      const admin = await createAdmin(prisma, { email: 'awa@batisso.test' });
      const cookies = await loginCookies('awa@batisso.test');
      await prisma.admin.update({
        where: { id: admin.id },
        data: { isActive: false },
      });

      await request(app.getHttpServer())
        .get('/api/v1/admin/auth/me')
        .set('Cookie', cookies.get(ACCESS)!.pair)
        .expect(401);
    });

    it('keeps health public', async () => {
      await request(app.getHttpServer()).get('/api/v1/health').expect(200);
    });
  });

  describe('PATCH /admin/auth/password', () => {
    function changePassword(
      accessPair: string,
      currentPassword: string,
      newPassword: string,
    ) {
      return request(app.getHttpServer())
        .patch('/api/v1/admin/auth/password')
        .set('Cookie', accessPair)
        .send({ currentPassword, newPassword });
    }

    it('lets a new admin reach me and password, then unlocks the rest', async () => {
      await createAdmin(prisma, {
        email: 'new@batisso.test',
        mustChangePassword: true,
      });
      const cookies = await loginCookies('new@batisso.test');
      const access = cookies.get(ACCESS)!.pair;

      const me = await request(app.getHttpServer())
        .get('/api/v1/admin/auth/me')
        .set('Cookie', access)
        .expect(200);
      expect(me.body.mustChangePassword).toBe(true);

      await changePassword(access, TEST_PASSWORD, 'Nouveau#2026').expect(204);

      const after = await request(app.getHttpServer())
        .get('/api/v1/admin/auth/me')
        .set('Cookie', access)
        .expect(200);
      expect(after.body.mustChangePassword).toBe(false);
      await login('new@batisso.test', 'Nouveau#2026').expect(200);
      await login('new@batisso.test', TEST_PASSWORD).expect(401);
    });

    it('signs out the other sessions but keeps the current one', async () => {
      await createAdmin(prisma, { email: 'awa@batisso.test' });
      const laptop = await loginCookies('awa@batisso.test');
      const phone = await loginCookies('awa@batisso.test');

      await changePassword(
        laptop.get(ACCESS)!.pair,
        TEST_PASSWORD,
        'Nouveau#2026',
      ).expect(204);

      await request(app.getHttpServer())
        .get('/api/v1/admin/auth/me')
        .set('Cookie', laptop.get(ACCESS)!.pair)
        .expect(200);
      await request(app.getHttpServer())
        .get('/api/v1/admin/auth/me')
        .set('Cookie', phone.get(ACCESS)!.pair)
        .expect(401);
    });

    it('refuses a wrong current password', async () => {
      await createAdmin(prisma, { email: 'awa@batisso.test' });
      const cookies = await loginCookies('awa@batisso.test');

      const response = await changePassword(
        cookies.get(ACCESS)!.pair,
        'Wrong#Pass1',
        'Nouveau#2026',
      ).expect(401);
      expect(response.body.error).toBe('INVALID_CREDENTIALS');
    });

    it('refuses a new password equal to the current one', async () => {
      await createAdmin(prisma, { email: 'awa@batisso.test' });
      const cookies = await loginCookies('awa@batisso.test');

      const response = await changePassword(
        cookies.get(ACCESS)!.pair,
        TEST_PASSWORD,
        TEST_PASSWORD,
      ).expect(400);
      expect(response.body.message).toBe(
        'Le nouveau mot de passe doit être différent de l’actuel',
      );
    });

    it('refuses a weak new password with the French rule', async () => {
      await createAdmin(prisma, { email: 'awa@batisso.test' });
      const cookies = await loginCookies('awa@batisso.test');

      const response = await changePassword(
        cookies.get(ACCESS)!.pair,
        TEST_PASSWORD,
        'faible',
      ).expect(400);
      expect(response.body.details[0].field).toBe('newPassword');
      expect(response.body.details[0].errors[0]).toMatch(
        /^Le mot de passe doit contenir/,
      );
    });
  });
});
