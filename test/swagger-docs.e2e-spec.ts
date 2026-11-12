import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types.js';
import { AppModule } from '../src/app.module.js';
import { Environment } from '../src/config/env.validation.js';
import { configureApp } from '../src/configure-app.js';
import { setupDocs, type DocsSettings } from '../src/swagger.js';

const USER = 'frontdev';
const PASSWORD = 'docs-password-0123456789';
const DOCS_PATHS = ['/docs', '/docs/', '/docs-json', '/docs-yaml'];

/** The real app, with setupDocs called as main.ts does, for the given settings. */
async function createApp(
  settings: DocsSettings,
): Promise<INestApplication<App>> {
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();
  const app = moduleRef.createNestApplication<INestApplication<App>>();
  configureApp(app);
  setupDocs(app, settings);
  await app.init();
  return app;
}

const basic = (user: string, password: string): string =>
  `Basic ${Buffer.from(`${user}:${password}`).toString('base64')}`;

describe('API docs (e2e)', () => {
  describe('in development', () => {
    let app: INestApplication<App>;

    beforeAll(async () => {
      app = await createApp({ NODE_ENV: Environment.Development });
    });
    afterAll(async () => {
      await app.close();
    });

    it('serves /docs and /docs-json without credentials', async () => {
      await request(app.getHttpServer()).get('/docs/').expect(200);
      const json = await request(app.getHttpServer())
        .get('/docs-json')
        .expect(200);
      expect((json.body as { info: { title: string } }).info.title).toBe(
        'API Bâtisso',
      );
    });
  });

  describe('in production without credentials', () => {
    let app: INestApplication<App>;

    beforeAll(async () => {
      app = await createApp({ NODE_ENV: Environment.Production });
    });
    afterAll(async () => {
      await app.close();
    });

    it.each(DOCS_PATHS)('does not serve %s (404)', async (path) => {
      await request(app.getHttpServer()).get(path).expect(404);
    });

    it('still serves the API', async () => {
      await request(app.getHttpServer()).get('/api/v1/health').expect(200);
    });
  });

  describe('in production with SWAGGER_USER and SWAGGER_PASSWORD', () => {
    let app: INestApplication<App>;

    beforeAll(async () => {
      app = await createApp({
        NODE_ENV: Environment.Production,
        SWAGGER_USER: USER,
        SWAGGER_PASSWORD: PASSWORD,
      });
    });
    afterAll(async () => {
      await app.close();
    });

    it.each([...DOCS_PATHS, '/DOCS-JSON', '/docs/swagger-ui-init.js'])(
      'asks for credentials on %s (401, nothing from the docs)',
      async (path) => {
        const response = await request(app.getHttpServer())
          .get(path)
          .expect(401);

        expect(response.headers['www-authenticate']).toBe(
          'Basic realm="Batisso API docs", charset="UTF-8"',
        );
        expect(response.text).not.toMatch(/API Bâtisso|swagger/i);
      },
    );

    it.each([
      ['a wrong user', basic('someone', PASSWORD)],
      ['a wrong password', basic(USER, `${PASSWORD}x`)],
      ['an empty password', basic(USER, '')],
      ['no colon', `Basic ${Buffer.from(USER + PASSWORD).toString('base64')}`],
      ['another scheme', `Bearer ${PASSWORD}`],
      ['garbage', 'Basic !!!'],
    ])('refuses %s (401)', async (_label, authorization) => {
      await request(app.getHttpServer())
        .get('/docs-json')
        .set('Authorization', authorization)
        .expect(401);
    });

    it('serves the Swagger UI and the document with the right credentials', async () => {
      const ui = await request(app.getHttpServer())
        .get('/docs/')
        .set('Authorization', basic(USER, PASSWORD))
        .expect(200);
      expect(ui.text).toMatch(/swagger/i);

      const json = await request(app.getHttpServer())
        .get('/docs-json')
        .set('Authorization', basic(USER, PASSWORD))
        .expect(200);
      expect((json.body as { info: { title: string } }).info.title).toBe(
        'API Bâtisso',
      );
    });

    it('accepts the scheme in any case, as HTTP allows', async () => {
      await request(app.getHttpServer())
        .get('/docs-json')
        .set('Authorization', basic(USER, PASSWORD).replace('Basic', 'basic'))
        .expect(200);
    });

    it('leaves the API routes alone (no credentials asked)', async () => {
      const response = await request(app.getHttpServer())
        .get('/api/v1/health')
        .expect(200);
      expect(response.headers['www-authenticate']).toBeUndefined();
    });
  });
});
