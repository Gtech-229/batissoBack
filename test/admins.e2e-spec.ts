import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { createAdmin } from './utils/admins.js';
import { accessCookieFor, createTestApp } from './utils/app.js';
import { CapturingEmailSender } from './utils/email.js';
import { resetDatabase } from './utils/reset-database.js';

const UNKNOWN_ID = '0192f0a4-7b1c-7c3e-9d2a-5e6f7a8b9c0d';

describe('Admin management (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let superCookie: string;
  let superId: string;
  let roleId: string;
  const emails = new CapturingEmailSender();

  beforeAll(async () => {
    app = await createTestApp({ email: emails });
    prisma = app.get(PrismaService);
  });

  beforeEach(async () => {
    await resetDatabase(prisma);
    emails.clear();
    const superAdmin = await createAdmin(prisma, {
      email: 'super@batisso.test',
      role: 'SUPER_ADMIN',
    });
    superId = superAdmin.id;
    superCookie = await accessCookieFor(app, 'super@batisso.test');
    roleId = (
      await prisma.accessRole.create({
        data: { name: 'Support', permissions: ['stores.read'] },
      })
    ).id;
  });

  afterAll(async () => {
    await app.close();
  });

  const api = () => request(app.getHttpServer());
  const newAdmin = () => ({
    email: '  Moussa@Batisso.TEST ',
    firstName: ' Moussa ',
    lastName: 'Keita',
    roleId,
  });

  describe('access', () => {
    it('refuses every route without a session', async () => {
      await api().get('/api/v1/admin/admins').expect(401);
      await api().post('/api/v1/admin/admins').send(newAdmin()).expect(401);
    });

    it('refuses an ADMIN on every route', async () => {
      const admin = await createAdmin(prisma, { email: 'awa@batisso.test' });
      const cookie = await accessCookieFor(app, 'awa@batisso.test');

      const list = await api()
        .get('/api/v1/admin/admins')
        .set('Cookie', cookie)
        .expect(403);
      expect(list.body).toMatchObject({
        error: 'FORBIDDEN',
        message: 'Accès refusé',
      });
      await api()
        .post('/api/v1/admin/admins')
        .set('Cookie', cookie)
        .send(newAdmin())
        .expect(403);
      await api()
        .patch(`/api/v1/admin/admins/${admin.id}/deactivate`)
        .set('Cookie', cookie)
        .expect(403);
    });
  });

  describe('POST /admin/admins', () => {
    it('creates an ADMIN without a password', async () => {
      const response = await api()
        .post('/api/v1/admin/admins')
        .set('Cookie', superCookie)
        .send(newAdmin())
        .expect(201);

      expect(response.body).toMatchObject({
        email: 'moussa@batisso.test',
        firstName: 'Moussa',
        lastName: 'Keita',
        role: 'ADMIN',
        hasPassword: false,
        isActive: true,
        roleId,
      });
      expect(response.body).not.toHaveProperty('passwordHash');
      const stored = await prisma.admin.findUniqueOrThrow({
        where: { email: 'moussa@batisso.test' },
      });
      expect(stored.createdById).toBe(superId);
      expect(stored.passwordHash).toBeNull();

      // No password yet: sign-in is refused like a wrong password, until the
      // admin sets one from a link they ask for.
      const login = await api()
        .post('/api/v1/admin/auth/login')
        .send({ email: 'moussa@batisso.test', password: 'Initial#2026' })
        .expect(401);
      expect(login.body.error).toBe('INVALID_CREDENTIALS');
    });

    it('refuses an email already used, whatever its case', async () => {
      await createAdmin(prisma, { email: 'moussa@batisso.test' });

      const response = await api()
        .post('/api/v1/admin/admins')
        .set('Cookie', superCookie)
        .send(newAdmin())
        .expect(409);

      expect(response.body).toMatchObject({
        error: 'EMAIL_ALREADY_USED',
        message: 'Cet email est déjà utilisé',
      });
    });

    it('validates every field in French', async () => {
      const response = await api()
        .post('/api/v1/admin/admins')
        .set('Cookie', superCookie)
        .send({ email: 'nope', firstName: '   ' })
        .expect(400);

      const fields = (response.body.details as { field: string }[]).map(
        (d) => d.field,
      );
      expect(fields.sort()).toEqual(
        ['email', 'firstName', 'lastName', 'roleId'].sort(),
      );
    });

    it('rejects an attempt to choose the role', async () => {
      const response = await api()
        .post('/api/v1/admin/admins')
        .set('Cookie', superCookie)
        .send({ ...newAdmin(), role: 'SUPER_ADMIN' })
        .expect(400);

      expect(response.body.details).toEqual([
        { field: 'role', errors: ["Ce champ n'est pas autorisé"] },
      ]);
    });

    it('refuses an initial password: the admin chooses their own', async () => {
      const response = await api()
        .post('/api/v1/admin/admins')
        .set('Cookie', superCookie)
        .send({ ...newAdmin(), password: 'Initial#2026' })
        .expect(400);

      expect(response.body.details).toEqual([
        { field: 'password', errors: ["Ce champ n'est pas autorisé"] },
      ]);
    });
  });

  describe('GET /admin/admins', () => {
    it('lists every admin, newest first, without secrets', async () => {
      await createAdmin(prisma, { email: 'older@batisso.test' });
      await createAdmin(prisma, { email: 'newer@batisso.test' });

      const response = await api()
        .get('/api/v1/admin/admins')
        .set('Cookie', superCookie)
        .expect(200);

      expect(response.body.map((a: { email: string }) => a.email)).toEqual([
        'newer@batisso.test',
        'older@batisso.test',
        'super@batisso.test',
      ]);
      expect(JSON.stringify(response.body)).not.toMatch(/passwordHash|scrypt/);
    });
  });

  describe('PATCH /admin/admins/:id', () => {
    const edit = (id: string, body: object) =>
      api()
        .patch(`/api/v1/admin/admins/${id}`)
        .set('Cookie', superCookie)
        .send(body);
    const askSetLink = (email: string) =>
      api()
        .post('/api/v1/admin/auth/forgot-password?mode=set')
        .send({ email })
        .expect(202);

    it('corrects a mistyped email: the old link dies, a new one reaches the new address', async () => {
      const admin = await createAdmin(prisma, {
        email: 'mousa@batisso.test',
        passwordHash: null,
      });
      await askSetLink('mousa@batisso.test');
      const oldToken = emails
        .lastLinkFor('mousa@batisso.test')
        .searchParams.get('token')!;

      const response = await edit(admin.id, {
        email: ' Moussa@Batisso.TEST ',
      }).expect(200);

      expect(response.body).toMatchObject({
        id: admin.id,
        email: 'moussa@batisso.test',
        firstName: 'Awa',
        hasPassword: false,
      });
      const refused = await api()
        .post('/api/v1/admin/auth/reset-password')
        .send({ token: oldToken, password: 'Nouveau#2026' })
        .expect(400);
      expect(refused.body.error).toBe('INVALID_PASSWORD_TOKEN');

      // The one-minute cooldown is per admin, so it still counts after the
      // correction: let it pass.
      await prisma.adminPasswordToken.updateMany({
        data: { createdAt: new Date(Date.now() - 61_000) },
      });
      await askSetLink('moussa@batisso.test');
      const token = emails
        .lastLinkFor('moussa@batisso.test')
        .searchParams.get('token')!;
      await api()
        .post('/api/v1/admin/auth/reset-password')
        .send({ token, password: 'Nouveau#2026' })
        .expect(204);
      await api()
        .post('/api/v1/admin/auth/login')
        .send({ email: 'moussa@batisso.test', password: 'Nouveau#2026' })
        .expect(200);
    });

    it('changes only the names sent and keeps the links', async () => {
      const admin = await createAdmin(prisma, {
        email: 'awa@batisso.test',
        passwordHash: null,
      });
      await askSetLink('awa@batisso.test');

      const response = await edit(admin.id, { lastName: ' Traoré ' }).expect(
        200,
      );

      expect(response.body).toMatchObject({
        email: 'awa@batisso.test',
        firstName: 'Awa',
        lastName: 'Traoré',
      });
      const [token] = await prisma.adminPasswordToken.findMany();
      expect(token.usedAt).toBeNull();
    });

    it('refuses an email already used', async () => {
      const admin = await createAdmin(prisma, { email: 'awa@batisso.test' });
      await createAdmin(prisma, { email: 'moussa@batisso.test' });

      const response = await edit(admin.id, {
        email: 'MOUSSA@batisso.test',
      }).expect(409);

      expect(response.body.error).toBe('EMAIL_ALREADY_USED');
    });

    it('refuses yourself and another super admin', async () => {
      const other = await createAdmin(prisma, { role: 'SUPER_ADMIN' });

      await edit(superId, { firstName: 'Moi' }).expect(403);
      await edit(other.id, { firstName: 'Autre' }).expect(403);
    });

    it('answers 404 for an unknown admin and 400 for bad data', async () => {
      const admin = await createAdmin(prisma);

      await edit(UNKNOWN_ID, { firstName: 'Awa' }).expect(404);
      const invalid = await edit(admin.id, {
        email: 'nope',
        firstName: '  ',
      }).expect(400);
      expect(
        (invalid.body.details as { field: string }[])
          .map((d) => d.field)
          .sort(),
      ).toEqual(['email', 'firstName']);
    });

    it.each(['email', 'firstName', 'lastName'])(
      'refuses null as %s with a 400, not a 500 (F-38)',
      async (field) => {
        const admin = await createAdmin(prisma);

        const response = await edit(admin.id, { [field]: null }).expect(400);

        expect(
          (response.body.details as { field: string }[]).map((d) => d.field),
        ).toEqual([field]);
      },
    );

    it('is the super admin’s only', async () => {
      const admin = await createAdmin(prisma, { email: 'awa@batisso.test' });
      const cookie = await accessCookieFor(app, 'awa@batisso.test');

      await api()
        .patch(`/api/v1/admin/admins/${admin.id}`)
        .set('Cookie', cookie)
        .send({ firstName: 'Moi' })
        .expect(403);
    });
  });

  describe('deactivate / activate', () => {
    it('ends the target’s sessions at once and blocks login until reactivated', async () => {
      const target = await createAdmin(prisma, { email: 'awa@batisso.test' });
      const targetCookie = await accessCookieFor(app, 'awa@batisso.test');

      const deactivated = await api()
        .patch(`/api/v1/admin/admins/${target.id}/deactivate`)
        .set('Cookie', superCookie)
        .expect(200);
      expect(deactivated.body.isActive).toBe(false);

      await api()
        .get('/api/v1/admin/auth/me')
        .set('Cookie', targetCookie)
        .expect(401);
      const login = await api()
        .post('/api/v1/admin/auth/login')
        .send({ email: 'awa@batisso.test', password: 'Batisso#2026' })
        .expect(403);
      expect(login.body.error).toBe('ACCOUNT_DISABLED');

      const activated = await api()
        .patch(`/api/v1/admin/admins/${target.id}/activate`)
        .set('Cookie', superCookie)
        .expect(200);
      expect(activated.body.isActive).toBe(true);
      await accessCookieFor(app, 'awa@batisso.test');
    });

    it('refuses to target yourself', async () => {
      const response = await api()
        .patch(`/api/v1/admin/admins/${superId}/deactivate`)
        .set('Cookie', superCookie)
        .expect(403);

      expect(response.body.message).toBe(
        'Impossible de modifier votre propre compte ou celui d’un super administrateur',
      );
    });

    it('refuses to target another super admin', async () => {
      const other = await createAdmin(prisma, {
        email: 'super2@batisso.test',
        role: 'SUPER_ADMIN',
      });

      await api()
        .patch(`/api/v1/admin/admins/${other.id}/deactivate`)
        .set('Cookie', superCookie)
        .expect(403);
    });

    it('answers 404 for an unknown id and a French 400 for a malformed one', async () => {
      const unknown = await api()
        .patch(`/api/v1/admin/admins/${UNKNOWN_ID}/activate`)
        .set('Cookie', superCookie)
        .expect(404);
      expect(unknown.body.message).toBe('Administrateur introuvable');

      const malformed = await api()
        .patch('/api/v1/admin/admins/not-a-uuid/activate')
        .set('Cookie', superCookie)
        .expect(400);
      expect(malformed.body.message).toBe(
        'Identifiant d’administrateur invalide',
      );
    });
  });
});
