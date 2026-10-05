import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { AppModule } from '../../src/app.module.js';
import { configureApp } from '../../src/configure-app.js';
import { cookiesFrom, TEST_PASSWORD } from './admins.js';

/** The real app, configured like main.ts, against batisso_test. */
export async function createTestApp(): Promise<INestApplication<App>> {
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();
  const app = moduleRef.createNestApplication<INestApplication<App>>();
  configureApp(app);
  await app.init();
  return app;
}

/** Logs in and returns the access cookie as a `name=value` pair. */
export async function accessCookieFor(
  app: INestApplication<App>,
  email: string,
  password = TEST_PASSWORD,
): Promise<string> {
  const response = await request(app.getHttpServer())
    .post('/api/v1/admin/auth/login')
    .send({ email, password })
    .expect(200);
  return cookiesFrom(response.headers['set-cookie']).get(
    'batisso_admin_access',
  )!.pair;
}
