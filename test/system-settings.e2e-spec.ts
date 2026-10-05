import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { createAdmin } from './utils/admins.js';
import { accessCookieFor, createTestApp } from './utils/app.js';
import { resetDatabase } from './utils/reset-database.js';

describe('System settings (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let superCookie: string;
  let adminCookie: string;

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
  });

  beforeEach(async () => {
    await resetDatabase(prisma);
    await createAdmin(prisma, {
      email: 'super@batisso.test',
      role: 'SUPER_ADMIN',
    });
    await createAdmin(prisma, { email: 'awa@batisso.test' });
    superCookie = await accessCookieFor(app, 'super@batisso.test');
    adminCookie = await accessCookieFor(app, 'awa@batisso.test');
  });

  afterAll(async () => {
    await app.close();
  });

  const api = () => request(app.getHttpServer());

  it('lets any admin read the defaults', async () => {
    const response = await api()
      .get('/api/v1/admin/settings')
      .set('Cookie', adminCookie)
      .expect(200);

    expect(response.body).toEqual({ maxLoginAttempts: 5, maxAdminSessions: 3 });
  });

  it('refuses an update by an ADMIN', async () => {
    await api()
      .patch('/api/v1/admin/settings')
      .set('Cookie', adminCookie)
      .send({ maxLoginAttempts: 10 })
      .expect(403);
  });

  it('lets the super admin update one setting and keeps the other', async () => {
    const response = await api()
      .patch('/api/v1/admin/settings')
      .set('Cookie', superCookie)
      .send({ maxAdminSessions: 1 })
      .expect(200);

    expect(response.body).toEqual({ maxLoginAttempts: 5, maxAdminSessions: 1 });
    const read = await api()
      .get('/api/v1/admin/settings')
      .set('Cookie', adminCookie)
      .expect(200);
    expect(read.body.maxAdminSessions).toBe(1);
  });

  it.each([
    [{ maxLoginAttempts: 2 }, 'maxLoginAttempts'],
    [{ maxLoginAttempts: 21 }, 'maxLoginAttempts'],
    [{ maxLoginAttempts: 4.5 }, 'maxLoginAttempts'],
    [{ maxAdminSessions: 0 }, 'maxAdminSessions'],
    [{ maxAdminSessions: '3' }, 'maxAdminSessions'],
  ])('rejects %o', async (body, field) => {
    const response = await api()
      .patch('/api/v1/admin/settings')
      .set('Cookie', superCookie)
      .send(body)
      .expect(400);

    expect(response.body.details[0].field).toBe(field);
    expect(response.body.details[0].errors[0]).toMatch(/doit être un entier/);
  });

  it('applies a lower maxLoginAttempts from the next login', async () => {
    await api()
      .patch('/api/v1/admin/settings')
      .set('Cookie', superCookie)
      .send({ maxLoginAttempts: 3 })
      .expect(200);

    for (let attempt = 1; attempt <= 3; attempt++) {
      await api()
        .post('/api/v1/admin/auth/login')
        .send({ email: 'awa@batisso.test', password: 'Wrong#Pass1' })
        .expect(401);
    }
    const locked = await api()
      .post('/api/v1/admin/auth/login')
      .send({ email: 'awa@batisso.test', password: 'Batisso#2026' })
      .expect(403);
    expect(locked.body.error).toBe('ACCOUNT_LOCKED');
  });

  it('closes the oldest sessions when maxAdminSessions is lowered', async () => {
    await api()
      .patch('/api/v1/admin/settings')
      .set('Cookie', superCookie)
      .send({ maxAdminSessions: 1 })
      .expect(200);

    const second = await accessCookieFor(app, 'awa@batisso.test');

    await api()
      .get('/api/v1/admin/auth/me')
      .set('Cookie', adminCookie)
      .expect(401);
    await api().get('/api/v1/admin/auth/me').set('Cookie', second).expect(200);
  });
});
