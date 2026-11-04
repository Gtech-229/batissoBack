import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import type { Permission } from '../src/admin-auth/permissions.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { createAdmin } from './utils/admins.js';
import { accessCookieFor, createTestApp } from './utils/app.js';
import { createMali, createStoreRecord } from './utils/countries.js';
import { resetDatabase } from './utils/reset-database.js';

describe('Admin activity log (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let cookie: string;
  let storeId: string;
  let otherStoreId: string;
  let userId: string;

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
  });

  beforeEach(async () => {
    await resetDatabase(prisma);
    await createMali(prisma);
    storeId = (await createStoreRecord(prisma, { name: 'Quincaillerie Sira' }))
      .id;
    otherStoreId = (await createStoreRecord(prisma, { name: 'Le Bon Ciment' }))
      .id;
    userId = (
      await prisma.user.create({
        data: { phone: '+22376000000', firstName: 'Awa', lastName: 'Diallo' },
      })
    ).id;
    cookie = await signedIn(['activity.read']);
  });

  afterAll(async () => {
    await app.close();
  });

  async function signedIn(permissions: Permission[]) {
    const email = `a${Math.random().toString(36).slice(2, 8)}@batisso.test`;
    await createAdmin(prisma, { email, permissions });
    return accessCookieFor(app, email);
  }

  /** Inserts one entry directly (fast setup). */
  const entry = (
    action: 'SELLER_ADDED' | 'ARTICLE_CREATED' | 'ACCESS_RESET',
    at: string,
    store: string | null = storeId,
  ) =>
    prisma.activityLog.create({
      data: {
        storeId: store,
        userId,
        action,
        newValue: { note: action },
        device: 'device-0001',
        createdAt: new Date(at),
      },
    });

  /** Four entries over three days, in two stores and one with no store. */
  async function seed() {
    return {
      oldest: (await entry('SELLER_ADDED', '2026-10-01T08:00:00Z')).id,
      atEnd: (await entry('ARTICLE_CREATED', '2026-10-02T23:59:59Z')).id,
      elsewhere: (
        await entry('ARTICLE_CREATED', '2026-10-03T00:00:00Z', otherStoreId)
      ).id,
      noStore: (await entry('ACCESS_RESET', '2026-10-03T10:00:00Z', null)).id,
    };
  }

  const list = (query = '', as = cookie) =>
    request(app.getHttpServer())
      .get(`/api/v1/admin/activity${query}`)
      .set('Cookie', as);
  const idsOf = (body: { items: { id: string }[] }) =>
    body.items.map((e) => e.id);

  it('lists every store’s entries, newest first, with the store named', async () => {
    const ids = await seed();

    const response = await list().expect(200);

    expect(response.body).toMatchObject({ total: 4, page: 1, pageSize: 20 });
    expect(idsOf(response.body)).toEqual([
      ids.noStore,
      ids.elsewhere,
      ids.atEnd,
      ids.oldest,
    ]);
    expect(response.body.items[1]).toEqual({
      id: ids.elsewhere,
      action: 'ARTICLE_CREATED',
      author: { userId, firstName: 'Awa', lastName: 'Diallo' },
      oldValue: null,
      newValue: { note: 'ARTICLE_CREATED' },
      device: 'device-0001',
      createdAt: '2026-10-03T00:00:00.000Z',
      store: { id: otherStoreId, name: 'Le Bon Ciment' },
    });
    expect(response.body.items[0].store).toBeNull();
    expect(JSON.stringify(response.body)).not.toContain('+22376000000');
  });

  it.each([
    ['the store', '?storeId=STORE', ['atEnd', 'oldest']],
    ['the action', '?action=ARTICLE_CREATED', ['elsewhere', 'atEnd']],
    [
      'a period, both days included',
      '?from=2026-10-02&to=2026-10-02',
      ['atEnd'],
    ],
    ['a start only', '?from=2026-10-03', ['noStore', 'elsewhere']],
    ['an end only', '?to=2026-10-01', ['oldest']],
    [
      'everything together',
      '?storeId=STORE&action=ARTICLE_CREATED&from=2026-10-01&to=2026-10-03',
      ['atEnd'],
    ],
  ])('filters on %s', async (_label, query, expected) => {
    const ids = await seed();

    const response = await list(query.replace('STORE', storeId)).expect(200);

    expect(idsOf(response.body)).toEqual(
      expected.map((name) => ids[name as keyof typeof ids]),
    );
    expect(response.body.total).toBe(expected.length);
  });

  it('splits into pages', async () => {
    const ids = await seed();

    const second = await list('?page=2&pageSize=3').expect(200);

    expect(second.body).toMatchObject({ total: 4, page: 2, pageSize: 3 });
    expect(idsOf(second.body)).toEqual([ids.oldest]);
  });

  it('refuses an end before the start', async () => {
    const response = await list('?from=2026-10-03&to=2026-10-02').expect(400);

    expect(response.body).toMatchObject({
      error: 'INVALID_PERIOD',
      message: 'Le dernier jour doit être le même que le premier ou après',
    });
  });

  it('refuses bad filters in French', async () => {
    const response = await list(
      '?storeId=nope&action=DANCED&from=2026-02-30&to=0000-01-01',
    ).expect(400);

    expect(
      (response.body.details as { field: string }[]).map((d) => d.field),
    ).toEqual(['storeId', 'action', 'from', 'to']);
    expect(response.body.details[2].errors).toEqual([
      'La date doit être au format AAAA-MM-JJ',
    ]);
  });

  it('refuses an admin without activity.read, and without a session', async () => {
    const other = await signedIn(['disputes.read', 'stores.read']);

    await list('', other).expect(403);
    await request(app.getHttpServer())
      .get('/api/v1/admin/activity')
      .expect(401);
  });
});
