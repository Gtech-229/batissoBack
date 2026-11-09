import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { PERMISSION_NAMES } from '../src/admin-auth/permissions.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { createAdmin } from './utils/admins.js';
import { accessCookieFor, createTestApp } from './utils/app.js';
import { resetDatabase } from './utils/reset-database.js';

const UNKNOWN_ID = '0192f0a4-7b1c-7c3e-9d2a-5e6f7a8b9c0d';

interface Role {
  id: string;
  name: string;
  permissions: string[];
  adminCount: number;
}

describe('Admin roles (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let superCookie: string;
  let superId: string;

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
  });

  beforeEach(async () => {
    await resetDatabase(prisma);
    superId = (
      await createAdmin(prisma, {
        email: 'super@batisso.test',
        role: 'SUPER_ADMIN',
      })
    ).id;
    superCookie = await accessCookieFor(app, 'super@batisso.test');
  });

  afterAll(async () => {
    await app.close();
  });

  const api = () => request(app.getHttpServer());
  const as = (cookie: string) => ({
    get: (path: string) => api().get(path).set('Cookie', cookie),
    post: (path: string, body: object) =>
      api().post(path).set('Cookie', cookie).send(body),
    patch: (path: string, body: object) =>
      api().patch(path).set('Cookie', cookie).send(body),
    delete: (path: string) => api().delete(path).set('Cookie', cookie),
  });
  const superAdmin = () => as(superCookie);
  const errorOf = (res: { body: unknown }) =>
    (res.body as { error: string }).error;

  const createRole = async (name = 'Support', permissions = ['stores.read']) =>
    (
      await superAdmin()
        .post('/api/v1/admin/roles', { name, permissions })
        .expect(201)
    ).body as Role;

  describe('GET /admin/permissions', () => {
    it('lists every permission with a French label', async () => {
      const res = await superAdmin()
        .get('/api/v1/admin/permissions')
        .expect(200);

      const list = res.body as { name: string; label: string }[];
      expect(list.map((item) => item.name)).toEqual(PERMISSION_NAMES);
      expect(list.every((item) => item.label.length > 0)).toBe(true);
    });
  });

  describe('roles', () => {
    it('creates a role, trimming its name', async () => {
      const res = await superAdmin()
        .post('/api/v1/admin/roles', {
          name: '  Support  ',
          permissions: ['stores.read', 'countries.read'],
        })
        .expect(201);

      expect(res.body).toEqual({
        id: expect.any(String) as string,
        name: 'Support',
        permissions: ['stores.read', 'countries.read'],
        adminCount: 0,
      });
    });

    it('accepts a role with no permission', async () => {
      await superAdmin()
        .post('/api/v1/admin/roles', { name: 'Vide', permissions: [] })
        .expect(201);
    });

    it.each([
      ['an unknown permission', { name: 'X', permissions: ['admins.manage'] }],
      [
        'a permission twice',
        { name: 'X', permissions: ['stores.read', 'stores.read'] },
      ],
      ['no permissions list', { name: 'X' }],
      ['an empty name', { name: '   ', permissions: [] }],
      ['a name too long', { name: 'x'.repeat(61), permissions: [] }],
    ])('refuses %s', async (_, body) => {
      await superAdmin().post('/api/v1/admin/roles', body).expect(400);

      expect(await prisma.accessRole.count()).toBe(0);
    });

    it('refuses a name already taken', async () => {
      await createRole('Support');

      const res = await superAdmin()
        .post('/api/v1/admin/roles', { name: 'Support', permissions: [] })
        .expect(409);

      expect(errorOf(res)).toBe('ROLE_NAME_TAKEN');
    });

    it('lists the roles by name, with how many admins hold each', async () => {
      const support = await createRole('Support');
      await createRole('Audit', ['countries.read']);
      await createAdmin(prisma, { roleId: support.id });

      const res = await superAdmin().get('/api/v1/admin/roles').expect(200);

      const roles = res.body as Role[];
      expect(roles.map((role) => role.name)).toEqual(['Audit', 'Support']);
      expect(roles[1].adminCount).toBe(1);
    });

    it('renames a role and changes its permissions', async () => {
      const role = await createRole('Support');

      const res = await superAdmin()
        .patch(`/api/v1/admin/roles/${role.id}`, {
          name: 'Support niveau 2',
          permissions: ['stores.read', 'stores.manage'],
        })
        .expect(200);

      expect(res.body).toMatchObject({
        name: 'Support niveau 2',
        permissions: ['stores.read', 'stores.manage'],
      });
    });

    it('changes only what is sent', async () => {
      const role = await createRole('Support', ['stores.read']);

      const res = await superAdmin()
        .patch(`/api/v1/admin/roles/${role.id}`, { name: 'Accueil' })
        .expect(200);

      expect(res.body).toMatchObject({
        name: 'Accueil',
        permissions: ['stores.read'],
      });
    });

    it('refuses a rename to a taken name, an unknown role, and bad values', async () => {
      await createRole('Support');
      const other = await createRole('Audit');

      const taken = await superAdmin()
        .patch(`/api/v1/admin/roles/${other.id}`, { name: 'Support' })
        .expect(409);
      expect(errorOf(taken)).toBe('ROLE_NAME_TAKEN');
      await superAdmin()
        .patch(`/api/v1/admin/roles/${UNKNOWN_ID}`, { name: 'Y' })
        .expect(404);
      await superAdmin()
        .patch(`/api/v1/admin/roles/${other.id}`, { permissions: ['nope'] })
        .expect(400);
      await superAdmin()
        .patch('/api/v1/admin/roles/not-a-uuid', { name: 'Y' })
        .expect(400);
    });

    it('refuses null for the name or the permissions (F-33)', async () => {
      const role = await createRole('Support', ['stores.read']);

      const name = await superAdmin()
        .patch(`/api/v1/admin/roles/${role.id}`, { name: null })
        .expect(400);
      const permissions = await superAdmin()
        .patch(`/api/v1/admin/roles/${role.id}`, { permissions: null })
        .expect(400);

      expect(name.body.details).toEqual([
        {
          field: 'name',
          errors: expect.arrayContaining([
            'Le nom du rôle doit contenir 1 à 60 caractères',
          ]),
        },
      ]);
      expect(permissions.body.details).toEqual([
        {
          field: 'permissions',
          errors: expect.arrayContaining([
            'Les permissions doivent être une liste',
          ]),
        },
      ]);
      expect(
        await prisma.accessRole.findUniqueOrThrow({ where: { id: role.id } }),
      ).toMatchObject({ name: 'Support', permissions: ['stores.read'] });
    });

    it('deletes an unused role, and refuses one still held', async () => {
      const unused = await createRole('Audit');
      const held = await createRole('Support');
      await createAdmin(prisma, { roleId: held.id });

      await superAdmin().delete(`/api/v1/admin/roles/${unused.id}`).expect(204);
      const res = await superAdmin()
        .delete(`/api/v1/admin/roles/${held.id}`)
        .expect(409);

      expect(errorOf(res)).toBe('ROLE_IN_USE');
      expect(await prisma.accessRole.count()).toBe(1);
      await superAdmin().delete(`/api/v1/admin/roles/${unused.id}`).expect(404);
    });
  });

  describe('PATCH /admin/admins/:id/role', () => {
    it('gives an admin another role, counted from the next request', async () => {
      const reader = await createRole('Lecture', ['countries.read']);
      const email = 'moussa@batisso.test';
      const admin = await createAdmin(prisma, {
        email,
        permissions: ['stores.read'],
      });
      const cookie = await accessCookieFor(app, email);
      await as(cookie).get('/api/v1/admin/countries').expect(403);

      const res = await superAdmin()
        .patch(`/api/v1/admin/admins/${admin.id}/role`, { roleId: reader.id })
        .expect(200);

      expect((res.body as { roleId: string }).roleId).toBe(reader.id);
      await as(cookie).get('/api/v1/admin/countries').expect(200);
      await as(cookie).get('/api/v1/admin/stores').expect(403);
    });

    it('refuses the super admin, an unknown admin or role, and a bad id', async () => {
      const role = await createRole('Support');
      const admin = await createAdmin(prisma, {});

      const res = await superAdmin()
        .patch(`/api/v1/admin/admins/${superId}/role`, { roleId: role.id })
        .expect(409);
      expect(errorOf(res)).toBe('SUPER_ADMIN_HAS_NO_ROLE');
      await superAdmin()
        .patch(`/api/v1/admin/admins/${UNKNOWN_ID}/role`, { roleId: role.id })
        .expect(404);
      await superAdmin()
        .patch(`/api/v1/admin/admins/${admin.id}/role`, { roleId: UNKNOWN_ID })
        .expect(404);
      await superAdmin()
        .patch(`/api/v1/admin/admins/${admin.id}/role`, { roleId: 'nope' })
        .expect(400);
    });
  });

  describe('creating an admin', () => {
    const newAdmin = (roleId: unknown) => ({
      email: 'awa@batisso.test',
      firstName: 'Awa',
      lastName: 'Diallo',
      roleId,
    });

    it('gives the new admin the role chosen', async () => {
      const role = await createRole('Support');

      await superAdmin()
        .post('/api/v1/admin/admins', newAdmin(role.id))
        .expect(201);

      const stored = await prisma.admin.findUniqueOrThrow({
        where: { email: 'awa@batisso.test' },
      });
      expect(stored.roleId).toBe(role.id);
    });

    it('needs an existing role', async () => {
      await superAdmin()
        .post('/api/v1/admin/admins', newAdmin(undefined))
        .expect(400);
      await superAdmin()
        .post('/api/v1/admin/admins', newAdmin(UNKNOWN_ID))
        .expect(404);

      expect(await prisma.admin.count()).toBe(1);
    });
  });

  describe('GET /admin/auth/me', () => {
    it('gives an admin their role’s permissions', async () => {
      const email = 'moussa@batisso.test';
      await createAdmin(prisma, {
        email,
        permissions: ['stores.read', 'countries.read'],
      });

      const res = await as(await accessCookieFor(app, email))
        .get('/api/v1/admin/auth/me')
        .expect(200);

      expect((res.body as { permissions: string[] }).permissions).toEqual([
        'stores.read',
        'countries.read',
      ]);
    });

    it('gives the super admin every permission', async () => {
      const res = await superAdmin().get('/api/v1/admin/auth/me').expect(200);

      expect((res.body as { permissions: string[] }).permissions).toEqual(
        PERMISSION_NAMES,
      );
    });

    it('gives an admin without a role none', async () => {
      const email = 'norole@batisso.test';
      await createAdmin(prisma, { email, roleId: null });

      const res = await as(await accessCookieFor(app, email))
        .get('/api/v1/admin/auth/me')
        .expect(200);

      expect((res.body as { permissions: string[] }).permissions).toEqual([]);
    });
  });

  describe('access', () => {
    it('refuses an admin on every role route, whatever their permissions', async () => {
      const email = 'all@batisso.test';
      const role = await createRole('Tout', [...PERMISSION_NAMES]);
      await createAdmin(prisma, { email, roleId: role.id });
      const admin = as(await accessCookieFor(app, email));

      await admin.get('/api/v1/admin/permissions').expect(403);
      await admin.get('/api/v1/admin/roles').expect(403);
      await admin
        .post('/api/v1/admin/roles', { name: 'X', permissions: [] })
        .expect(403);
      await admin
        .patch(`/api/v1/admin/roles/${role.id}`, { name: 'Y' })
        .expect(403);
      await admin.delete(`/api/v1/admin/roles/${role.id}`).expect(403);
      await admin
        .patch(`/api/v1/admin/admins/${superId}/role`, { roleId: role.id })
        .expect(403);
      expect(
        (await prisma.accessRole.findUniqueOrThrow({ where: { id: role.id } }))
          .name,
      ).toBe('Tout');
    });

    it('needs a session', async () => {
      await api().get('/api/v1/admin/roles').expect(401);
      await api().get('/api/v1/admin/permissions').expect(401);
    });
  });
});
