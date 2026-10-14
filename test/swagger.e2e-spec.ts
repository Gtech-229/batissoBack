import type { INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import type { App } from 'supertest/types.js';
import { createTestApp } from './utils/app.js';

type Operation = {
  summary?: string;
  responses?: Record<string, unknown>;
  security?: Record<string, unknown>[];
};

describe('Swagger document (e2e)', () => {
  let app: INestApplication<App>;
  let operations: [string, Operation][];

  beforeAll(async () => {
    app = await createTestApp();
    const document = SwaggerModule.createDocument(
      app,
      new DocumentBuilder().build(),
    );
    operations = Object.entries(document.paths).flatMap(([path, item]) =>
      Object.entries(item as Record<string, Operation>).map(
        ([method, operation]): [string, Operation] => [
          `${method.toUpperCase()} ${path}`,
          operation,
        ],
      ),
    );
  });

  afterAll(async () => {
    await app.close();
  });

  it('documents the country routes', () => {
    const routes = operations.map(([route]) => route);

    expect(routes).toEqual(
      expect.arrayContaining([
        'POST /api/v1/admin/countries',
        'GET /api/v1/admin/countries',
        'GET /api/v1/admin/countries/{code}',
        'PATCH /api/v1/admin/countries/{code}',
      ]),
    );
  });

  it('gives every route a French summary and a documented success response', () => {
    const undocumented = operations
      .filter(
        ([, operation]) =>
          !operation.summary ||
          !Object.keys(operation.responses ?? {}).some((status) =>
            status.startsWith('2'),
          ),
      )
      .map(([route]) => route);

    expect(undocumented).toEqual([]);
  });

  it('marks the mobile session routes with Bearer auth', () => {
    const security = (route: string) =>
      operations.find(([name]) => name === route)?.[1].security;

    for (const route of ['GET /api/v1/me', 'POST /api/v1/auth/logout']) {
      expect(security(route)).toEqual([{ bearer: [] }]);
    }
    expect(security('POST /api/v1/auth/login')).toBeUndefined();
  });

  it('documents the 403 ACCOUNT_LOCKED of the admin password change (F-17)', () => {
    const changePassword = operations.find(
      ([route]) => route === 'PATCH /api/v1/admin/auth/password',
    )?.[1];

    expect(Object.keys(changePassword?.responses ?? {})).toContain('403');
  });

  it('documents the 400 for a malformed store id on every store route (F-20)', () => {
    const storeRoutes = operations.filter(([route]) =>
      route.includes('/stores/{storeId}'),
    );
    const without400 = storeRoutes
      .filter(([, operation]) => !operation.responses?.['400'])
      .map(([route]) => route);

    expect(storeRoutes.length).toBeGreaterThanOrEqual(5);
    expect(without400).toEqual([]);
  });
});
