import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { AppModule } from '../../src/app.module.js';
import { configureApp } from '../../src/configure-app.js';
import { SMS_SENDER, type SmsSender } from '../../src/sms/sms-sender.js';
import { cookiesFrom, TEST_PASSWORD } from './admins.js';

/**
 * The real app, configured like main.ts, against batisso_test. Pass `sms` to
 * replace the console SMS sender (to read the codes a test receives).
 */
export async function createTestApp(
  options: { sms?: SmsSender } = {},
): Promise<INestApplication<App>> {
  let builder = Test.createTestingModule({ imports: [AppModule] });
  if (options.sms) {
    builder = builder.overrideProvider(SMS_SENDER).useValue(options.sms);
  }
  const moduleRef = await builder.compile();
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
