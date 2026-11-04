import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import type { Permission } from '../src/admin-auth/permissions.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { createAdmin } from './utils/admins.js';
import { accessCookieFor, createTestApp } from './utils/app.js';
import { createMali, createStoreRecord } from './utils/countries.js';
import { resetDatabase } from './utils/reset-database.js';

const UNKNOWN_ID = '0192f0a4-7b1c-7c3e-9d2a-5e6f7a8b9c0d';
const BOTH: Permission[] = ['subscriptions.read', 'subscriptions.manage'];

/** The UTC day `offset` days from today, as `YYYY-MM-DD`. */
function day(offset: number): string {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + offset);
  return date.toISOString().slice(0, 10);
}

describe('Subscriptions (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let cookie: string;
  let adminId: string;
  let storeId: string;

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
  });

  beforeEach(async () => {
    await resetDatabase(prisma);
    await createMali(prisma);
    storeId = (await createStoreRecord(prisma, { status: 'VERIFIED' })).id;
    ({ adminId, cookie } = await signedIn(BOTH));
  });

  afterAll(async () => {
    await app.close();
  });

  async function signedIn(permissions: Permission[]) {
    const email = `a${Math.random().toString(36).slice(2, 8)}@batisso.test`;
    const admin = await createAdmin(prisma, { email, permissions });
    return { adminId: admin.id, cookie: await accessCookieFor(app, email) };
  }

  const record = (body: object, id = storeId, as = cookie) =>
    request(app.getHttpServer())
      .post(`/api/v1/admin/stores/${id}/subscriptions`)
      .set('Cookie', as)
      .send(body);
  const list = (id = storeId, as = cookie) =>
    request(app.getHttpServer())
      .get(`/api/v1/admin/stores/${id}/subscriptions`)
      .set('Cookie', as);
  const period = (from: number, to: number, plan = 'STANDARD') => ({
    plan,
    startsOn: day(from),
    endsOn: day(to),
  });

  describe('POST /admin/stores/:id/subscriptions', () => {
    it('records a subscription with its computed status, and nothing about the admin', async () => {
      const response = await record(period(-5, 20)).expect(201);

      expect(response.body).toEqual({
        id: expect.any(String) as string,
        storeId,
        plan: 'STANDARD',
        startsOn: day(-5),
        endsOn: day(20),
        status: 'ACTIVE',
        createdAt: expect.any(String) as string,
        updatedAt: expect.any(String) as string,
      });
      const stored = await prisma.subscription.findUniqueOrThrow({
        where: { id: response.body.id as string },
      });
      expect(stored).toMatchObject({
        createdById: adminId,
        updatedById: adminId,
      });
    });

    it.each([
      ['UPCOMING', 1, 30],
      ['ACTIVE', 0, 0],
      ['EXPIRED', -30, -1],
    ])('computes %s', async (status, from, to) => {
      const response = await record(period(from, to, 'TRIAL')).expect(201);

      expect(response.body.status).toBe(status);
    });

    it('refuses an end before the start', async () => {
      const response = await record(period(10, 9)).expect(400);

      expect(response.body.error).toBe('INVALID_SUBSCRIPTION_PERIOD');
    });

    it('refuses an overlap, even of one day, and accepts the next day', async () => {
      await record(period(1, 10)).expect(201);

      const overlap = await record(period(10, 20, 'PRO')).expect(409);
      expect(overlap.body.error).toBe('SUBSCRIPTION_OVERLAP');
      await record(period(-5, 1)).expect(409);
      await record(period(-5, 30)).expect(409);
      await record(period(11, 20, 'PRO')).expect(201);
      expect(await prisma.subscription.count()).toBe(2);
    });

    it('lets only one of two parallel overlapping periods pass', async () => {
      const statuses = (
        await Promise.all([record(period(1, 10)), record(period(5, 15))])
      )
        .map((r) => r.status)
        .sort((a, b) => a - b);

      expect(statuses).toEqual([201, 409]);
      expect(await prisma.subscription.count()).toBe(1);
    });

    it('allows the same dates in another store', async () => {
      const other = await createStoreRecord(prisma, { name: 'Autre' });
      await record(period(1, 10)).expect(201);

      await record(period(1, 10), other.id).expect(201);
    });

    it('refuses a closed store but not a suspended one', async () => {
      const closed = await createStoreRecord(prisma, { status: 'CLOSED' });
      const suspended = await createStoreRecord(prisma, {
        status: 'SUSPENDED',
      });

      const refused = await record(period(1, 10), closed.id).expect(409);
      expect(refused.body.error).toBe('STORE_CLOSED');
      await record(period(1, 10), suspended.id).expect(201);
    });

    it('answers 404 for an unknown store and 400 for a malformed id', async () => {
      await record(period(1, 10), UNKNOWN_ID).expect(404);
      await record(period(1, 10), 'not-a-uuid').expect(400);
    });

    it('validates every field in French', async () => {
      const response = await record({
        plan: 'GOLD',
        startsOn: '2026-02-30',
      }).expect(400);

      expect(response.body.details).toEqual([
        {
          field: 'plan',
          errors: ['La formule doit être TRIAL, STANDARD ou PRO'],
        },
        {
          field: 'startsOn',
          errors: ['La date doit être au format AAAA-MM-JJ'],
        },
        { field: 'endsOn', errors: ['La date doit être au format AAAA-MM-JJ'] },
      ]);
    });
  });

  describe('GET /admin/stores/:id/subscriptions', () => {
    it('lists the store’s subscriptions, newest first', async () => {
      await record(period(-60, -31, 'TRIAL')).expect(201);
      await record(period(1, 30, 'PRO')).expect(201);
      await record(period(-30, 0)).expect(201);

      const response = await list().expect(200);

      expect(
        (response.body as { plan: string; status: string }[]).map(
          (s) => `${s.plan} ${s.status}`,
        ),
      ).toEqual(['PRO UPCOMING', 'STANDARD ACTIVE', 'TRIAL EXPIRED']);
    });

    it('is empty for a store without any, and 404 for an unknown store', async () => {
      expect((await list().expect(200)).body).toEqual([]);
      await list(UNKNOWN_ID).expect(404);
    });
  });

  describe('PATCH /admin/subscriptions/:subscriptionId', () => {
    const edit = (id: string, body: object, as = cookie) =>
      request(app.getHttpServer())
        .patch(`/api/v1/admin/subscriptions/${id}`)
        .set('Cookie', as)
        .send(body);
    const recorded = async (from: number, to: number) =>
      (await record(period(from, to)).expect(201)).body.id as string;

    it('changes the plan and each date, one at a time', async () => {
      const id = await recorded(1, 10);

      const plan = await edit(id, { plan: 'PRO' }).expect(200);
      expect(plan.body).toMatchObject({
        plan: 'PRO',
        startsOn: day(1),
        endsOn: day(10),
      });
      expect(
        (await edit(id, { startsOn: day(-2) }).expect(200)).body,
      ).toMatchObject({ startsOn: day(-2), endsOn: day(10), status: 'ACTIVE' });
      expect(
        (await edit(id, { endsOn: day(40) }).expect(200)).body.endsOn,
      ).toBe(day(40));
    });

    it('records the editing admin', async () => {
      const id = await recorded(1, 10);
      const editor = await signedIn(BOTH);

      await edit(id, { plan: 'PRO' }, editor.cookie).expect(200);

      const stored = await prisma.subscription.findUniqueOrThrow({
        where: { id },
      });
      expect(stored).toMatchObject({
        createdById: adminId,
        updatedById: editor.adminId,
      });
    });

    it('ends a subscription early: it is EXPIRED from the next day', async () => {
      const id = await recorded(-10, 20);

      const response = await edit(id, { endsOn: day(-1) }).expect(200);

      expect(response.body.status).toBe('EXPIRED');
    });

    it('refuses an end before the start, against the stored start too', async () => {
      const id = await recorded(1, 10);

      const response = await edit(id, { endsOn: day(0) }).expect(400);

      expect(response.body.error).toBe('INVALID_SUBSCRIPTION_PERIOD');
    });

    it('refuses an overlap with another subscription, not with itself', async () => {
      const first = await recorded(1, 10);
      await recorded(11, 20);

      await edit(first, { startsOn: day(0), endsOn: day(9) }).expect(200);
      const overlap = await edit(first, { endsOn: day(11) }).expect(409);
      expect(overlap.body.error).toBe('SUBSCRIPTION_OVERLAP');
    });

    it('still corrects a subscription of a closed store', async () => {
      const id = await recorded(1, 10);
      await prisma.hardwareStore.update({
        where: { id: storeId },
        data: { status: 'CLOSED' },
      });

      await edit(id, { endsOn: day(5) }).expect(200);
    });

    it.each(['plan', 'startsOn', 'endsOn'])(
      'refuses null as %s with a 400',
      async (field) => {
        const id = await recorded(1, 10);

        const response = await edit(id, { [field]: null }).expect(400);

        expect(
          (response.body.details as { field: string }[]).map((d) => d.field),
        ).toEqual([field]);
      },
    );

    it('answers 404 for an unknown id, 400 for a malformed one, 403 without the permission', async () => {
      const id = await recorded(1, 10);
      const reader = await signedIn(['subscriptions.read']);

      await edit(UNKNOWN_ID, { plan: 'PRO' }).expect(404);
      await edit('nope', { plan: 'PRO' }).expect(400);
      await edit(id, { plan: 'PRO' }, reader.cookie).expect(403);
    });
  });

  describe('subscription state on the admin stores', () => {
    // The store routes need stores.read only, not the subscription permissions.
    let viewerCookie: string;

    beforeEach(async () => {
      viewerCookie = (await signedIn(['stores.read'])).cookie;
    });

    const detail = (id: string) =>
      request(app.getHttpServer())
        .get(`/api/v1/admin/stores/${id}`)
        .set('Cookie', viewerCookie);
    const stores = (query = '') =>
      request(app.getHttpServer())
        .get(`/api/v1/admin/stores${query}`)
        .set('Cookie', viewerCookie);

    /** One store per state: ACTIVE, UPCOMING (after an ended one), EXPIRED, NONE. */
    async function fourStores() {
      const ids = {
        ACTIVE: storeId,
        UPCOMING: (await createStoreRecord(prisma, { name: 'À venir' })).id,
        EXPIRED: (await createStoreRecord(prisma, { name: 'Terminée' })).id,
        NONE: (await createStoreRecord(prisma, { name: 'Jamais' })).id,
      };
      await record(period(-40, -11, 'TRIAL')).expect(201);
      await record(period(-10, 10)).expect(201);
      await record(period(-30, -1, 'TRIAL'), ids.UPCOMING).expect(201);
      await record(period(5, 30), ids.UPCOMING).expect(201);
      await record(period(-30, -1), ids.EXPIRED).expect(201);
      return ids;
    }

    it('shows each state and only the active subscription on the detail', async () => {
      const ids = await fourStores();

      const active = await detail(ids.ACTIVE).expect(200);
      expect(active.body.subscriptionState).toBe('ACTIVE');
      expect(active.body.currentSubscription).toMatchObject({
        plan: 'STANDARD',
        startsOn: day(-10),
        endsOn: day(10),
        status: 'ACTIVE',
      });
      for (const state of ['UPCOMING', 'EXPIRED', 'NONE'] as const) {
        const response = await detail(ids[state]).expect(200);
        expect(response.body).toMatchObject({
          subscriptionState: state,
          currentSubscription: null,
        });
      }
    });

    it('shows the state on each line of the list', async () => {
      const ids = await fourStores();

      const response = await stores().expect(200);

      const byId = new Map(
        (
          response.body.items as {
            id: string;
            subscriptionState: string;
            currentSubscription: { plan: string } | null;
          }[]
        ).map((s) => [s.id, s]),
      );
      for (const [state, id] of Object.entries(ids)) {
        expect(byId.get(id)?.subscriptionState).toBe(state);
      }
      expect(byId.get(ids.ACTIVE)?.currentSubscription?.plan).toBe('STANDARD');
      expect(byId.get(ids.NONE)?.currentSubscription).toBeNull();
    });

    it.each(['ACTIVE', 'UPCOMING', 'EXPIRED', 'NONE'] as const)(
      'filters the list on %s, with the total and paging of that state',
      async (state) => {
        const ids = await fourStores();

        const response = await stores(
          `?subscriptionState=${state}&pageSize=1`,
        ).expect(200);

        expect(response.body.total).toBe(1);
        expect(
          (response.body.items as { id: string }[]).map((s) => s.id),
        ).toEqual([ids[state]]);
      },
    );

    it('counts a subscription ending today as active, and one ending yesterday as expired', async () => {
      const yesterday = await createStoreRecord(prisma, { name: 'Hier' });
      await record(period(-10, 0)).expect(201);
      await record(period(-10, -1), yesterday.id).expect(201);

      expect((await detail(storeId).expect(200)).body.subscriptionState).toBe(
        'ACTIVE',
      );
      expect(
        (await detail(yesterday.id).expect(200)).body.subscriptionState,
      ).toBe('EXPIRED');
    });

    it('refuses an unknown state in the filter', async () => {
      const response = await stores('?subscriptionState=LATE').expect(400);

      expect(response.body.details).toEqual([
        {
          field: 'subscriptionState',
          errors: [
            'L’état d’abonnement doit être ACTIVE, UPCOMING, EXPIRED ou NONE',
          ],
        },
      ]);
    });
  });

  describe('permissions', () => {
    it('lets subscriptions.read list but not record', async () => {
      const reader = await signedIn(['subscriptions.read']);

      await list(storeId, reader.cookie).expect(200);
      await record(period(1, 10), storeId, reader.cookie).expect(403);
    });

    it('refuses an admin without the permissions', async () => {
      const other = await signedIn(['stores.read', 'stores.manage']);

      await list(storeId, other.cookie).expect(403);
      await record(period(1, 10), storeId, other.cookie).expect(403);
      expect(await prisma.subscription.count()).toBe(0);
    });
  });
});
