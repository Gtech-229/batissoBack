import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types.js';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/configure-app.js';
import { PrismaService } from '../src/prisma/prisma.service.js';

async function createApp(
  prismaOverride?: Partial<PrismaService>,
): Promise<INestApplication<App>> {
  let builder = Test.createTestingModule({ imports: [AppModule] });
  if (prismaOverride) {
    builder = builder.overrideProvider(PrismaService).useValue(prismaOverride);
  }
  const moduleRef = await builder.compile();
  const app = moduleRef.createNestApplication<INestApplication<App>>();
  configureApp(app);
  await app.init();
  return app;
}

describe('Health (e2e, real test database)', () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    app = await createApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /api/v1/health reports the API and database as up', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/v1/health')
      .expect(200);

    expect(response.body).toEqual({
      status: 'ok',
      database: 'up',
      timestamp: expect.any(String),
    });
  });

  it('an unknown route returns the French error shape', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/v1/does-not-exist')
      .expect(404);

    expect(response.body).toEqual({
      statusCode: 404,
      error: 'NOT_FOUND',
      message: 'Ressource introuvable',
      path: '/api/v1/does-not-exist',
      timestamp: expect.any(String),
    });
  });

  it('malformed JSON returns a French 400', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/v1/health')
      .set('Content-Type', 'application/json')
      .send('{bad')
      .expect(400);

    expect(response.body.message).toBe('Requête invalide');
  });
});

describe('Health (e2e, database unreachable)', () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    app = await createApp({
      $queryRaw: vi.fn().mockRejectedValue(new Error('ECONNREFUSED')),
    } as unknown as Partial<PrismaService>);
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /api/v1/health returns 503 in the error shape', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/v1/health')
      .expect(503);

    expect(response.body).toEqual({
      statusCode: 503,
      error: 'SERVICE_UNAVAILABLE',
      message: 'Base de données indisponible',
      path: '/api/v1/health',
      timestamp: expect.any(String),
    });
  });
});
