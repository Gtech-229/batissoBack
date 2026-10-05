import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types.js';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/configure-app.js';

// .env.test sets CORS_ORIGINS=http://localhost:5173
describe('CORS (e2e)', () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('allows the configured admin origin with credentials', async () => {
    const response = await request(app.getHttpServer())
      .options('/api/v1/health')
      .set('Origin', 'http://localhost:5173')
      .set('Access-Control-Request-Method', 'POST')
      .expect(204);

    expect(response.headers['access-control-allow-origin']).toBe(
      'http://localhost:5173',
    );
    expect(response.headers['access-control-allow-credentials']).toBe('true');
  });

  it('gives no CORS headers to another origin', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/v1/health')
      .set('Origin', 'https://evil.example.com');

    expect(response.headers['access-control-allow-origin']).toBeUndefined();
    expect(response.headers['access-control-allow-credentials']).toBe('true');
  });
});
