import type { INestApplication } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import type { Permission } from '../src/admin-auth/permissions.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { createAdmin } from './utils/admins.js';
import { accessCookieFor, createTestApp } from './utils/app.js';
import { createMali, createStoreRecord } from './utils/countries.js';
import { CapturingPushSender } from './utils/push.js';
import { resetDatabase } from './utils/reset-database.js';
import { CapturingSmsSender } from './utils/sms.js';
import { signedInStaff, type MobileStaff } from './utils/staff.js';

const UNKNOWN_ID = '0192f0a4-7b1c-7c3e-9d2a-5e6f7a8b9c0d';

describe('Admin disputes (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  const sms = new CapturingSmsSender();
  const push = new CapturingPushSender();
  let cookie: string;
  let storeId: string;
  let otherStoreId: string;
  let manager: MobileStaff;
  let otherManager: MobileStaff;
  let customer: MobileStaff;
  /** The disputes, by state: open and answered here, closed and open elsewhere. */
  let ids: {
    open: string;
    answered: string;
    closed: string;
    elsewhere: string;
  };

  beforeAll(async () => {
    app = await createTestApp({ sms, push });
    prisma = app.get(PrismaService);
  });

  beforeEach(async () => {
    await resetDatabase(prisma);
    await createMali(prisma);
    storeId = (
      await createStoreRecord(prisma, {
        name: 'Quincaillerie Sira',
        status: 'VERIFIED',
      })
    ).id;
    otherStoreId = (
      await createStoreRecord(prisma, {
        name: 'Le Bon Ciment',
        status: 'VERIFIED',
      })
    ).id;
    manager = await signedInStaff(app, prisma, {
      phone: '+22376000000',
      firstName: 'Awa',
      store: { id: storeId, role: 'MANAGER' },
    });
    otherManager = await signedInStaff(app, prisma, {
      phone: '+22376000001',
      firstName: 'Moussa',
      store: { id: otherStoreId, role: 'MANAGER' },
    });
    customer = await signedInStaff(app, prisma, {
      phone: '+22376445566',
      firstName: 'Fanta',
    });
    const here = await openAccount(storeId, manager);
    const there = await openAccount(otherStoreId, otherManager);

    // In time order: the last one opened is the newest.
    const closed = await dispute(there, otherStoreId, otherManager);
    await reply(closed, otherStoreId, otherManager);
    await api()
      .post(`/api/v1/me/accounts/${there}/disputes/${closed}/close`)
      .set('Authorization', customer.authorization)
      .expect(200);
    const open = await dispute(here, storeId, manager);
    const answered = await dispute(here, storeId, manager);
    await reply(answered, storeId, manager);
    const elsewhere = await dispute(there, otherStoreId, otherManager);
    ids = { open, answered, closed, elsewhere };

    cookie = await signedIn(['disputes.read']);
  });

  afterAll(async () => {
    await app.close();
  });

  const api = () => request(app.getHttpServer());

  async function signedIn(permissions: Permission[]) {
    const email = `a${Math.random().toString(36).slice(2, 8)}@batisso.test`;
    await createAdmin(prisma, { email, permissions });
    return accessCookieFor(app, email);
  }

  async function openAccount(store: string, as: MobileStaff) {
    return (
      await api()
        .post(`/api/v1/stores/${store}/accounts`)
        .set('Authorization', as.authorization)
        .send({
          customer: {
            phone: customer.phone,
            firstName: 'Fanta',
            lastName: 'Keita',
          },
          termsAccepted: true,
        })
        .expect(201)
    ).body.id as string;
  }

  /** A deposit, then the customer disputes it: the dispute's id. */
  async function dispute(account: string, store: string, as: MobileStaff) {
    const deposit = (
      await api()
        .post(`/api/v1/stores/${store}/accounts/${account}/deposits`)
        .set('Authorization', as.authorization)
        .set('Idempotency-Key', randomUUID())
        .send({ amount: '5000' })
        .expect(201)
    ).body.id as string;
    return (
      await api()
        .post(`/api/v1/me/accounts/${account}/operations/${deposit}/disputes`)
        .set('Authorization', customer.authorization)
        .send({ message: 'Je n’ai pas versé ce montant' })
        .expect(201)
    ).body.id as string;
  }

  async function reply(disputeId: string, store: string, as: MobileStaff) {
    await api()
      .post(`/api/v1/stores/${store}/disputes/${disputeId}/messages`)
      .set('Authorization', as.authorization)
      .send({ message: 'Nous vérifions le cahier.' })
      .expect(201);
  }

  const list = (query = '', as = cookie) =>
    api().get(`/api/v1/admin/disputes${query}`).set('Cookie', as);
  const detail = (id: string, as = cookie) =>
    api().get(`/api/v1/admin/disputes/${id}`).set('Cookie', as);
  const idsOf = (body: { items: { id: string }[] }) =>
    body.items.map((d) => d.id);

  describe('GET /admin/disputes', () => {
    it('lists the unresolved disputes of every store, newest first, with the store and thread', async () => {
      const response = await list().expect(200);

      expect(response.body).toMatchObject({ total: 3, page: 1, pageSize: 20 });
      expect(idsOf(response.body)).toEqual([
        ids.elsewhere,
        ids.answered,
        ids.open,
      ]);
      const answered = (
        response.body.items as {
          id: string;
          status: string;
          store: { id: string; name: string };
          customer: { firstName: string };
          messages: { author: string; body: string }[];
        }[]
      ).find((d) => d.id === ids.answered)!;
      expect(answered).toMatchObject({
        status: 'ANSWERED',
        store: { id: storeId, name: 'Quincaillerie Sira' },
        customer: { firstName: 'Fanta' },
        messages: [
          { author: 'CUSTOMER', body: 'Je n’ai pas versé ce montant' },
          { author: 'STORE', body: 'Nous vérifions le cahier.' },
        ],
      });
      expect(JSON.stringify(response.body)).not.toMatch(/\+223|balance/);
    });

    it.each([
      ['OPEN', '?status=OPEN', () => [ids.elsewhere, ids.open]],
      ['ANSWERED', '?status=ANSWERED', () => [ids.answered]],
      ['the store', '?storeId=STORE', () => [ids.answered, ids.open]],
      [
        'the store and a status',
        '?storeId=STORE&status=OPEN',
        () => [ids.open],
      ],
    ])('filters on %s', async (_label, query, expected) => {
      const response = await list(query.replace('STORE', storeId)).expect(200);

      expect(idsOf(response.body)).toEqual(expected());
      expect(response.body.total).toBe(expected().length);
    });

    it('splits into pages', async () => {
      const second = await list('?page=2&pageSize=2').expect(200);

      expect(second.body).toMatchObject({ total: 3, page: 2, pageSize: 2 });
      expect(idsOf(second.body)).toEqual([ids.open]);
    });

    it('refuses CLOSED and bad filters in French', async () => {
      const response = await list('?status=CLOSED&storeId=nope').expect(400);

      expect(response.body.details).toEqual([
        { field: 'status', errors: ['L’état doit être OPEN ou ANSWERED'] },
        { field: 'storeId', errors: ['Identifiant de quincaillerie invalide'] },
      ]);
    });
  });

  describe('GET /admin/disputes/:disputeId', () => {
    it('gives an unresolved dispute with its thread', async () => {
      const response = await detail(ids.elsewhere).expect(200);

      expect(response.body).toMatchObject({
        id: ids.elsewhere,
        status: 'OPEN',
        store: { id: otherStoreId, name: 'Le Bon Ciment' },
        messages: [{ author: 'CUSTOMER' }],
      });
    });

    it('answers 404 for a closed dispute, like an unknown one, and 400 for a malformed id', async () => {
      const closed = await detail(ids.closed).expect(404);
      const unknown = await detail(UNKNOWN_ID).expect(404);

      expect(closed.body.message).toBe(unknown.body.message);
      await detail('nope').expect(400);
    });
  });

  describe('permissions', () => {
    it('refuses an admin without disputes.read, and without a session', async () => {
      const other = await signedIn(['stores.read', 'accounts.read']);

      await list('', other).expect(403);
      await detail(ids.open, other).expect(403);
      await api().get('/api/v1/admin/disputes').expect(401);
    });

    it('changes nothing: the admin routes only read', async () => {
      const before = await prisma.dispute.findMany({ orderBy: { id: 'asc' } });

      await list().expect(200);
      await detail(ids.open).expect(200);

      expect(await prisma.dispute.findMany({ orderBy: { id: 'asc' } })).toEqual(
        before,
      );
    });
  });
});
