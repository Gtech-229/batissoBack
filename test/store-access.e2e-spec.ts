import type { INestApplication } from '@nestjs/common';
import { PATH_METADATA } from '@nestjs/common/constants.js';
import { MetadataScanner, ModulesContainer, Reflector } from '@nestjs/core';
import type { App } from 'supertest/types.js';
import { AllowedStoreRoles } from '../src/store-access/decorators/allowed-store-roles.decorator.js';
import { createTestApp } from './utils/app.js';

/** `['admin', 'stores']` or `'stores/:storeId'` -> `'stores/:storeId'`. */
const joined = (path: unknown): string =>
  (Array.isArray(path) ? path : [path ?? ''])
    .map((part) => String(part).replace(/^\/|\/$/g, ''))
    .filter(Boolean)
    .join('/');

describe('Store access: route coverage (e2e)', () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it('protects every route under :storeId with StoreRoles', () => {
    const reflector = app.get(Reflector);
    const scanner = new MetadataScanner();
    const unprotected: string[] = [];
    let routes = 0;
    let storeRoutes = 0;

    const controllers = [...app.get(ModulesContainer).values()].flatMap(
      (module) => [...module.controllers.values()],
    );
    for (const wrapper of controllers) {
      const controller = wrapper.metatype as (new () => object) | null;
      if (!controller) {
        continue;
      }
      const prefix = joined(Reflect.getMetadata(PATH_METADATA, controller));
      for (const name of scanner.getAllMethodNames(controller.prototype)) {
        const handler = (controller.prototype as Record<string, unknown>)[
          name
        ] as object;
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
        const roles = reflector.getAllAndOverride(AllowedStoreRoles, [
          handler as () => void,
          controller,
        ]);
        if (!roles?.length) {
          unprotected.push(`${controller.name}.${name} (${path})`);
        }
      }
    }

    expect(unprotected).toEqual([]);
    // Guards the test itself: it must really have walked the app's routes.
    expect(routes).toBeGreaterThan(30);
    // The team and activity routes (feature 4) at least: the check ran on them.
    expect(storeRoutes).toBeGreaterThanOrEqual(5);
  });
});
