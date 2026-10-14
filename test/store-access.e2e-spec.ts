import { Controller, Get, type INestApplication } from '@nestjs/common';
import { GUARDS_METADATA, PATH_METADATA } from '@nestjs/common/constants.js';
import { MetadataScanner, ModulesContainer, Reflector } from '@nestjs/core';
import type { App } from 'supertest/types.js';
import { AllowedStoreRoles } from '../src/store-access/decorators/allowed-store-roles.decorator.js';
import { StoreRoles } from '../src/store-access/decorators/store-roles.decorator.js';
import { StoreAccessGuard } from '../src/store-access/store-access.guard.js';
import { createTestApp } from './utils/app.js';

type ControllerClass = new (...args: never[]) => object;

/** `['admin', 'stores']` or `'stores/:storeId'` -> `'stores/:storeId'`. */
const joined = (path: unknown): string =>
  (Array.isArray(path) ? path : [path ?? ''])
    .map((part) => String(part).replace(/^\/|\/$/g, ''))
    .filter(Boolean)
    .join('/');

/**
 * Every route of these controllers whose path contains `:storeId`, and those
 * that are not protected: a protected route has allowed roles AND the
 * StoreAccessGuard. Roles without the guard would isolate nothing (F-18).
 */
function scan(controllers: ControllerClass[]) {
  const reflector = new Reflector();
  const scanner = new MetadataScanner();
  const unprotected: string[] = [];
  let routes = 0;
  let storeRoutes = 0;

  for (const controller of controllers) {
    const prefix = joined(Reflect.getMetadata(PATH_METADATA, controller));
    for (const name of scanner.getAllMethodNames(controller.prototype)) {
      const handler = (controller.prototype as Record<string, unknown>)[
        name
      ] as () => void;
      const methodPath: unknown = Reflect.getMetadata(PATH_METADATA, handler);
      if (methodPath === undefined) {
        continue; // Not a route handler.
      }
      routes++;
      const path = joined([prefix, joined(methodPath)]);
      if (!path.includes(':storeId')) {
        continue;
      }
      storeRoutes++;
      const targets = [handler, controller];
      const roles = reflector.getAllAndOverride(AllowedStoreRoles, targets);
      const guards = reflector.getAllAndMerge<unknown[]>(
        GUARDS_METADATA,
        targets,
      );
      if (!roles?.length || !guards.includes(StoreAccessGuard)) {
        unprotected.push(`${controller.name}.${name} (${path})`);
      }
    }
  }
  return { unprotected, routes, storeRoutes };
}

// Test controllers, never registered in the app: they prove the check can fail.
@Controller('stores/:storeId/protected')
class ProtectedController {
  @Get()
  @StoreRoles(['MANAGER'])
  route() {}
}
@Controller('stores/:storeId/roles-only')
class RolesOnlyController {
  @Get()
  @AllowedStoreRoles(['MANAGER'])
  route() {}
}
@Controller('stores/:storeId/bare')
class BareController {
  @Get()
  route() {}
}

describe('Store access: route coverage (e2e)', () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it('protects every route under :storeId with StoreRoles (roles and guard)', () => {
    const controllers = [...app.get(ModulesContainer).values()]
      .flatMap((module) => [...module.controllers.values()])
      .map((wrapper) => wrapper.metatype as ControllerClass | null)
      .filter((controller): controller is ControllerClass => !!controller);

    const { unprotected, routes, storeRoutes } = scan(controllers);

    expect(unprotected).toEqual([]);
    // Guards the test itself: it must really have walked the app's routes.
    expect(routes).toBeGreaterThan(30);
    // The team and activity routes (feature 4) at least: the check ran on them.
    expect(storeRoutes).toBeGreaterThanOrEqual(5);
  });

  it('reports a route with roles but no guard, and a bare route (F-18)', () => {
    const { unprotected, storeRoutes } = scan([
      ProtectedController,
      RolesOnlyController,
      BareController,
    ]);

    expect(storeRoutes).toBe(3);
    expect(unprotected).toEqual([
      'RolesOnlyController.route (stores/:storeId/roles-only)',
      'BareController.route (stores/:storeId/bare)',
    ]);
  });
});
