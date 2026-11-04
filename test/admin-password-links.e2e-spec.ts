import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { DUMMY_PASSWORD } from '../src/admin-auth/admin-auth.service.js';
import { PASSWORD_LINK_REQUESTED } from '../src/admin-auth/password-links.service.js';
import { hashToken } from '../src/admin-auth/secrets.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { cookiesFrom, createAdmin, TEST_PASSWORD } from './utils/admins.js';
import { createTestApp } from './utils/app.js';
import { CapturingEmailSender } from './utils/email.js';
import { resetDatabase } from './utils/reset-database.js';

const EMAIL = 'awa@batisso.test';
const NEW_PASSWORD = 'Nouveau#2026';

describe('Admin password links (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  const emails = new CapturingEmailSender();

  beforeAll(async () => {
    app = await createTestApp({ email: emails });
    prisma = app.get(PrismaService);
  });

  beforeEach(async () => {
    await resetDatabase(prisma);
    emails.clear();
  });

  afterAll(async () => {
    await app.close();
  });

  const api = () => request(app.getHttpServer());

  function askLink(mode: string, email = EMAIL) {
    return api()
      .post(`/api/v1/admin/auth/forgot-password?mode=${mode}`)
      .send({ email });
  }

  function usePassword(token: string, password = NEW_PASSWORD) {
    return api()
      .post('/api/v1/admin/auth/reset-password')
      .send({ token, password });
  }

  function login(password: string, email = EMAIL) {
    return api().post('/api/v1/admin/auth/login').send({ email, password });
  }

  /** Asks for a link and returns the token it carries. */
  async function tokenFor(mode: 'set' | 'reset', email = EMAIL) {
    await askLink(mode, email).expect(202);
    const link = emails.lastLinkFor(email);
    expect(link.searchParams.get('mode')).toBe(mode);
    return link.searchParams.get('token')!;
  }

  /** Lets the next request pass the one-minute cooldown. */
  async function pastCooldown() {
    await prisma.adminPasswordToken.updateMany({
      data: { createdAt: new Date(Date.now() - 61_000) },
    });
  }

  describe('mode=set: a new admin chooses a first password', () => {
    it('emails a link, then the token sets the password and the admin signs in', async () => {
      await createAdmin(prisma, { email: EMAIL, passwordHash: null });
      await login(TEST_PASSWORD).expect(401);
      // Not even the public dummy password used for equal timing (F-36).
      const dummy = await login(DUMMY_PASSWORD).expect(401);
      expect(dummy.body.error).toBe('INVALID_CREDENTIALS');
      expect(await prisma.adminSession.count()).toBe(0);

      const asked = await askLink('set').expect(202);
      expect(asked.body).toEqual({ message: PASSWORD_LINK_REQUESTED });

      const [email] = emails.sentTo(EMAIL);
      expect(email.subject).toBe('Bâtisso : choisissez votre mot de passe');
      expect(email.text).toContain('Bonjour Awa,');
      expect(email.text).toContain('valable 3 jours');
      const link = emails.lastLinkFor(EMAIL);
      expect(link.origin + link.pathname).toBe(
        'http://localhost:5173/password',
      );
      const token = link.searchParams.get('token')!;

      // Only the hash is stored, never the token itself.
      const [stored] = await prisma.adminPasswordToken.findMany();
      expect(stored.mode).toBe('SET');
      expect(stored.tokenHash).toBe(hashToken(token));
      expect(JSON.stringify(stored)).not.toContain(token);
      const life = stored.expiresAt.getTime() - stored.createdAt.getTime();
      expect(Math.abs(life - 3 * 24 * 60 * 60 * 1000)).toBeLessThan(5_000);

      const used = await usePassword(token).expect(204);
      expect(used.text).toBe('');

      const signedIn = await login(NEW_PASSWORD).expect(200);
      expect(signedIn.body.hasPassword).toBe(true);
      expect(JSON.stringify(signedIn.body)).not.toContain(NEW_PASSWORD);
    });
  });

  describe('mode=reset: a forgotten password', () => {
    it('replaces the password, ends every session and clears the lockout', async () => {
      const admin = await createAdmin(prisma, { email: EMAIL });
      const laptop = cookiesFrom(
        (await login(TEST_PASSWORD).expect(200)).headers['set-cookie'],
      ).get('batisso_admin_access')!.pair;
      await login(TEST_PASSWORD).expect(200);
      await prisma.admin.update({
        where: { id: admin.id },
        data: {
          failedLoginAttempts: 2,
          lockedUntil: new Date(Date.now() + 10 * 60_000),
        },
      });

      const token = await tokenFor('reset');
      const [email] = emails.sentTo(EMAIL);
      expect(email.subject).toBe('Bâtisso : réinitialisez votre mot de passe');
      // Asking for a link changes nothing until the token is used.
      await api()
        .get('/api/v1/admin/auth/me')
        .set('Cookie', laptop)
        .expect(200);

      await usePassword(token).expect(204);

      const sessions = await prisma.adminSession.findMany({
        where: { adminId: admin.id },
      });
      expect(sessions).toHaveLength(2);
      expect(sessions.every((s) => s.revokedAt !== null)).toBe(true);
      await api()
        .get('/api/v1/admin/auth/me')
        .set('Cookie', laptop)
        .expect(401);
      const stored = await prisma.admin.findUniqueOrThrow({
        where: { id: admin.id },
      });
      expect(stored).toMatchObject({
        failedLoginAttempts: 0,
        lockedUntil: null,
      });

      await login(TEST_PASSWORD).expect(401);
      await login(NEW_PASSWORD).expect(200);
    });
  });

  describe('the same answer whatever the email', () => {
    it.each([
      ['an unknown email', 'reset', async () => {}],
      [
        'a deactivated admin',
        'reset',
        (prisma: PrismaService) =>
          createAdmin(prisma, { email: EMAIL, isActive: false }),
      ],
      [
        'set on an admin who has a password',
        'set',
        (prisma: PrismaService) => createAdmin(prisma, { email: EMAIL }),
      ],
      [
        'reset on an admin who has none yet',
        'reset',
        (prisma: PrismaService) =>
          createAdmin(prisma, { email: EMAIL, passwordHash: null }),
      ],
    ])('answers 202 and sends nothing for %s', async (_label, mode, given) => {
      await given(prisma);

      const response = await askLink(mode).expect(202);

      expect(response.body).toEqual({ message: PASSWORD_LINK_REQUESTED });
      expect(emails.messages).toEqual([]);
      expect(await prisma.adminPasswordToken.count()).toBe(0);
    });

    it('sends one email a minute at most, with the same answer', async () => {
      await createAdmin(prisma, { email: EMAIL });

      await askLink('reset').expect(202);
      const second = await askLink('reset').expect(202);

      expect(second.body).toEqual({ message: PASSWORD_LINK_REQUESTED });
      expect(emails.sentTo(EMAIL)).toHaveLength(1);
      expect(await prisma.adminPasswordToken.count()).toBe(1);
    });

    it('finds the admin whatever the case of the email', async () => {
      await createAdmin(prisma, { email: EMAIL });

      await askLink('reset', '  AWA@Batisso.TEST ').expect(202);

      expect(emails.sentTo(EMAIL)).toHaveLength(1);
    });
  });

  describe('validation', () => {
    it.each([
      ['no mode', ''],
      ['an unknown mode', 'mode=change'],
    ])('refuses %s', async (_label, query) => {
      const response = await api()
        .post(`/api/v1/admin/auth/forgot-password?${query}`)
        .send({ email: EMAIL })
        .expect(400);

      expect(response.body.details).toEqual([
        { field: 'mode', errors: ['Le mode doit être set ou reset'] },
      ]);
    });

    it('refuses a malformed email', async () => {
      const response = await askLink('reset', 'nope').expect(400);

      expect(response.body.details).toEqual([
        { field: 'email', errors: ['L’adresse email est invalide'] },
      ]);
    });

    it('refuses a password that breaks the rule and keeps the link usable', async () => {
      await createAdmin(prisma, { email: EMAIL });
      const token = await tokenFor('reset');

      const response = await usePassword(token, 'weak').expect(400);

      expect(response.body.details[0].field).toBe('password');
      await usePassword(token).expect(204);
    });
  });

  describe('a link that no longer works', () => {
    const invalid = { error: 'INVALID_PASSWORD_TOKEN' };

    it('refuses an unknown token', async () => {
      const response = await usePassword('not-a-real-token').expect(400);

      expect(response.body).toMatchObject({
        ...invalid,
        message: 'Ce lien n’est plus valable : demandez-en un nouveau',
      });
    });

    it('refuses a link used once already', async () => {
      await createAdmin(prisma, { email: EMAIL });
      const token = await tokenFor('reset');
      await usePassword(token).expect(204);

      const again = await usePassword(token, 'Autre#2026x').expect(400);

      expect(again.body).toMatchObject(invalid);
      await login(NEW_PASSWORD).expect(200);
    });

    it('lets only one of two parallel uses pass', async () => {
      await createAdmin(prisma, { email: EMAIL });
      const token = await tokenFor('reset');

      const statuses = (
        await Promise.all([
          usePassword(token, 'Premier#2026'),
          usePassword(token, 'Second#2026'),
        ])
      )
        .map((r) => r.status)
        .sort((a, b) => a - b);

      expect(statuses).toEqual([204, 400]);
    });

    it('refuses an expired link', async () => {
      await createAdmin(prisma, { email: EMAIL });
      const token = await tokenFor('reset');
      await prisma.adminPasswordToken.updateMany({
        data: { expiresAt: new Date(Date.now() - 1000) },
      });

      const response = await usePassword(token).expect(400);

      expect(response.body).toMatchObject(invalid);
      await login(TEST_PASSWORD).expect(200);
    });

    it('refuses a link replaced by a newer one; the newer one works', async () => {
      await createAdmin(prisma, { email: EMAIL });
      const first = await tokenFor('reset');
      await pastCooldown();
      const second = await tokenFor('reset');

      expect(emails.sentTo(EMAIL)).toHaveLength(2);
      expect((await usePassword(first).expect(400)).body).toMatchObject(
        invalid,
      );
      await usePassword(second).expect(204);
    });

    it('refuses a link once the admin is deactivated', async () => {
      const admin = await createAdmin(prisma, { email: EMAIL });
      const token = await tokenFor('reset');
      await prisma.admin.update({
        where: { id: admin.id },
        data: { isActive: false },
      });

      expect((await usePassword(token).expect(400)).body).toMatchObject(
        invalid,
      );
    });

    it('refuses a set link once the admin has a password', async () => {
      const admin = await createAdmin(prisma, {
        email: EMAIL,
        passwordHash: null,
      });
      const token = await tokenFor('set');
      const { passwordHash } = await createAdmin(prisma);
      await prisma.admin.update({
        where: { id: admin.id },
        data: { passwordHash },
      });

      expect((await usePassword(token).expect(400)).body).toMatchObject(
        invalid,
      );
      await login(TEST_PASSWORD).expect(200);
    });
  });
});
