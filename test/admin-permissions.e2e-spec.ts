import type { INestApplication } from '@nestjs/common';
import { PATH_METADATA } from '@nestjs/common/constants.js';
import { MetadataScanner, ModulesContainer, Reflector } from '@nestjs/core';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { OwnAccountRoute } from '../src/admin-auth/decorators/own-account-route.decorator.js';
import { Public } from '../src/admin-auth/decorators/public.decorator.js';
import {
  RequirePermission,
  SuperAdminOnly,
} from '../src/admin-auth/decorators/require-permission.decorator.js';
import type { Permission } from '../src/admin-auth/permissions.js';
import { MobileRoute } from '../src/mobile-auth/decorators/mobile-route.decorator.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { createAdmin } from './utils/admins.js';
import { accessCookieFor, createTestApp } from './utils/app.js';
import { resetDatabase } from './utils/reset-database.js';

type ControllerClass = new (...args: never[]) => object;

const joined = (path: unknown): string =>
  (Array.isArray(path) ? path : [path ?? ''])
    .map((part) => String(part).replace(/^\/|\/$/g, ''))
    .filter(Boolean)
    .join('/');

/**
 * Every admin route (not public, not mobile) and those with no marker: a marked
 * route names its permission, is the super admin's, or is an own-account route.
 */
function unmarkedAdminRoutes(controllers: ControllerClass[]) {
  const reflector = new Reflector();
  const scanner = new MetadataScanner();
  const unmarked: string[] = [];
  let adminRoutes = 0;
  for (const controller of controllers) {
    const prefix = joined(Reflect.getMetadata(PATH_METADATA, controller));
    for (const name of scanner.getAllMethodNames(controller.prototype)) {
      const handler = (controller.prototype as Record<string, unknown>)[
        name
      ] as () => void;
      const methodPath: unknown = Reflect.getMetadata(PATH_METADATA, handler);
      if (methodPath === undefined) {
        continue;
      }
      const targets = [handler, controller];
      if (
        reflector.getAllAndOverride(Public, targets) ||
        reflector.getAllAndOverride(MobileRoute, targets)
      ) {
        continue;
      }
      adminRoutes++;
      const marked =
        reflector.getAllAndOverride(RequirePermission, targets) ||
        reflector.getAllAndOverride(SuperAdminOnly, targets) ||
        reflector.getAllAndOverride(OwnAccountRoute, targets);
      if (!marked) {
        unmarked.push(
          `${controller.name}.${name} (${joined([prefix, joined(methodPath)])})`,
        );
      }
    }
  }
  return { unmarked, adminRoutes };
}

describe('Admin permissions (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
  });

  beforeEach(async () => {
    await resetDatabase(prisma);
  });

  afterAll(async () => {
    await app.close();
  });

  const api = () => request(app.getHttpServer());

  describe('route coverage', () => {
    it('marks every admin route with its permission, super admin, or own account', () => {
      const controllers = [...app.get(ModulesContainer).values()].flatMap(
        (module) =>
          [...module.controllers.values()].map(
            (wrapper) => wrapper.metatype as ControllerClass,
          ),
      );

      const { unmarked, adminRoutes } = unmarkedAdminRoutes(controllers);

      expect(adminRoutes).toBeGreaterThanOrEqual(20);
      expect(unmarked).toEqual([]);
    });

    it('reports an unmarked route', () => {
      class Unmarked {
        route() {}
      }
      Reflect.defineMetadata(PATH_METADATA, 'admin/test', Unmarked);
      Reflect.defineMetadata(
        PATH_METADATA,
        '/',
        Object.getOwnPropertyDescriptor(Unmarked.prototype, 'route')!.value,
      );

      expect(unmarkedAdminRoutes([Unmarked]).unmarked).toEqual([
        'Unmarked.route (admin/test)',
      ]);
    });
  });

  describe('checks', () => {
    async function signedIn(permissions: Permission[]) {
      const email = `a${Math.random().toString(36).slice(2, 8)}@batisso.test`;
      const admin = await createAdmin(prisma, { email, permissions });
      return { admin, cookie: await accessCookieFor(app, email) };
    }

    const get = (path: string, cookie: string) =>
      api().get(path).set('Cookie', cookie);

    it('allows a route with its permission and refuses the others with 403', async () => {
      const { cookie } = await signedIn(['countries.read']);

      await get('/api/v1/admin/countries', cookie).expect(200);
      await get('/api/v1/admin/stores', cookie).expect(403);
      await get('/api/v1/admin/settings', cookie).expect(403);
      await api()
        .post('/api/v1/admin/countries')
        .set('Cookie', cookie)
        .send({})
        .expect(403);
    });

    it('applies a change of the role on the next request, without signing in again', async () => {
      const { admin, cookie } = await signedIn(['countries.read']);
      await get('/api/v1/admin/stores', cookie).expect(403);

      await prisma.accessRole.update({
        where: { id: admin.roleId! },
        data: { permissions: ['countries.read', 'stores.read'] },
      });
      await get('/api/v1/admin/stores', cookie).expect(200);

      await prisma.accessRole.update({
        where: { id: admin.roleId! },
        data: { permissions: [] },
      });
      await get('/api/v1/admin/countries', cookie).expect(403);
    });

    it('leaves an admin with no role only their own account', async () => {
      const email = 'norole@batisso.test';
      await createAdmin(prisma, { email, roleId: null });
      const cookie = await accessCookieFor(app, email);

      await get('/api/v1/admin/auth/me', cookie).expect(200);
      await get('/api/v1/admin/countries', cookie).expect(403);
    });

    it('keeps admins management for the super admin, whatever the role', async () => {
      const { cookie } = await signedIn([
        'countries.read',
        'countries.manage',
        'stores.read',
        'stores.manage',
        'store-settings.manage',
        'settings.read',
        'settings.manage',
      ]);

      await get('/api/v1/admin/admins', cookie).expect(403);
      await get('/api/v1/admin/countries', cookie).expect(200);
    });

    it('lets the super admin through everywhere, with no role', async () => {
      const email = 'super@batisso.test';
      await createAdmin(prisma, { email, role: 'SUPER_ADMIN' });
      const cookie = await accessCookieFor(app, email);

      for (const path of [
        '/api/v1/admin/countries',
        '/api/v1/admin/stores',
        '/api/v1/admin/settings',
        '/api/v1/admin/admins',
      ]) {
        await get(path, cookie).expect(200);
      }
    });

    it('lets settings.manage change the system settings', async () => {
      const { cookie } = await signedIn(['settings.read', 'settings.manage']);
      const current = (await get('/api/v1/admin/settings', cookie).expect(200))
        .body as Record<string, unknown>;

      await api()
        .patch('/api/v1/admin/settings')
        .set('Cookie', cookie)
        .send({ maxPinAttempts: current.maxPinAttempts })
        .expect(200);
    });

    it('gives the Administrateur role today’s access, and no more', async () => {
      const email = 'default@batisso.test';
      await createAdmin(prisma, { email });
      const cookie = await accessCookieFor(app, email);

      await get('/api/v1/admin/countries', cookie).expect(200);
      await get('/api/v1/admin/stores', cookie).expect(200);
      await get('/api/v1/admin/settings', cookie).expect(200);
      await api()
        .patch('/api/v1/admin/settings')
        .set('Cookie', cookie)
        .send({ maxPinAttempts: 5 })
        .expect(403);
      await get('/api/v1/admin/admins', cookie).expect(403);
    });
  });
});
