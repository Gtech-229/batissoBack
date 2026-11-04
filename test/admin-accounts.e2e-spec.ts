import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import type { Permission } from '../src/admin-auth/permissions.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { createAdmin } from './utils/admins.js';
import { accessCookieFor, createTestApp } from './utils/app.js';
import { createMali, createStoreRecord } from './utils/countries.js';
import { resetDatabase } from './utils/reset-database.js';
import { CapturingSmsSender } from './utils/sms.js';

const UNKNOWN_ID = '0192f0a4-7b1c-7c3e-9d2a-5e6f7a8b9c0d';
const BOTH: Permission[] = ['accounts.read', 'accounts.manage'];

describe('Admin accounts (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let cookie: string;
  let adminId: string;
  let storeId: string;
  let otherStoreId: string;
  let sellerId: string;
  const sms = new CapturingSmsSender();

  beforeAll(async () => {
    app = await createTestApp({ sms });
    prisma = app.get(PrismaService);
  });

  beforeEach(async () => {
    await resetDatabase(prisma);
    sms.clear();
    await createMali(prisma);
    storeId = (await createStoreRecord(prisma, { status: 'VERIFIED' })).id;
    otherStoreId = (
      await createStoreRecord(prisma, {
        name: 'Le Bon Ciment',
        status: 'VERIFIED',
      })
    ).id;
    sellerId = (
      await prisma.user.create({
        data: { phone: '+22370000000', firstName: 'Vendeur', lastName: 'X' },
      })
    ).id;
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

  /** Inserts a customer and their account directly (fast setup). */
  async function account(options: {
    number: string;
    phone: string;
    firstName?: string;
    lastName?: string;
    store?: string;
    createdAt?: Date;
  }) {
    const customer = await prisma.user.upsert({
      where: { phone: options.phone },
      create: {
        phone: options.phone,
        firstName: options.firstName ?? 'Moussa',
        lastName: options.lastName ?? 'Keita',
      },
      update: {},
    });
    return prisma.account.create({
      data: {
        number: options.number,
        customerId: customer.id,
        storeId: options.store ?? storeId,
        currencyCode: 'XOF',
        balance: 125000n,
        termsAcceptedAt: new Date(),
        openedById: sellerId,
        createdAt: options.createdAt,
      },
    });
  }

  const list = (query = '', as = cookie) =>
    request(app.getHttpServer())
      .get(`/api/v1/admin/accounts${query}`)
      .set('Cookie', as);
  const suspend = (
    id: string,
    body: object = { reason: 'Fraude suspectée' },
    as = cookie,
  ) =>
    request(app.getHttpServer())
      .patch(`/api/v1/admin/accounts/${id}/suspend`)
      .set('Cookie', as)
      .send(body);
  const reactivate = (id: string, as = cookie) =>
    request(app.getHttpServer())
      .patch(`/api/v1/admin/accounts/${id}/reactivate`)
      .set('Cookie', as);

  const numbers = (body: { items: { number: string }[] }) =>
    body.items.map((a) => a.number);

  describe('GET /admin/accounts', () => {
    async function seed() {
      await account({
        number: 'C-000001',
        phone: '+22376000001',
        firstName: 'Awa',
        lastName: 'Traoré',
        createdAt: new Date('2026-10-01T00:00:00Z'),
      });
      await account({
        number: 'C-000002',
        phone: '+22376000002',
        createdAt: new Date('2026-10-02T00:00:00Z'),
      });
      await account({
        number: 'C-000003',
        phone: '+22376000001',
        firstName: 'Awa',
        lastName: 'Traoré',
        store: otherStoreId,
        createdAt: new Date('2026-10-03T00:00:00Z'),
      });
    }

    it('lists every store’s accounts, newest first, without money', async () => {
      await seed();

      const response = await list().expect(200);

      expect(response.body).toMatchObject({ total: 3, page: 1, pageSize: 20 });
      expect(numbers(response.body)).toEqual([
        'C-000003',
        'C-000002',
        'C-000001',
      ]);
      expect(response.body.items[0]).toEqual({
        id: expect.any(String) as string,
        number: 'C-000003',
        store: { id: otherStoreId, name: 'Le Bon Ciment' },
        customer: {
          id: expect.any(String) as string,
          firstName: 'Awa',
          lastName: 'Traoré',
          phone: '+22376000001',
        },
        status: 'ACTIVE',
        statusReason: null,
        statusChangedAt: null,
        createdAt: '2026-10-03T00:00:00.000Z',
      });
      expect(JSON.stringify(response.body)).not.toMatch(
        /balance|125000|idPhoto|beneficiary/,
      );
    });

    it.each([
      ['the number', '?q=c-000002', ['C-000002']],
      ['a first name, any case', '?q=AWA', ['C-000003', 'C-000001']],
      ['a last name', '?q=keita', ['C-000002']],
      ['local phone digits', '?q=76%2000%2000%2002', ['C-000002']],
      ['an international phone', '?q=%2B22376000001', ['C-000003', 'C-000001']],
      ['the store', `?storeId=STORE`, ['C-000002', 'C-000001']],
      ['the store and a name', `?storeId=STORE&q=awa`, ['C-000001']],
    ])('finds by %s', async (_label, query, expected) => {
      await seed();

      const response = await list(query.replace('STORE', storeId)).expect(200);

      expect(numbers(response.body)).toEqual(expected);
      expect(response.body.total).toBe(expected.length);
    });

    it('filters on the status and splits into pages', async () => {
      await seed();
      const suspended = await prisma.account.findUniqueOrThrow({
        where: { number: 'C-000002' },
      });
      await suspend(suspended.id).expect(200);

      expect(
        numbers((await list('?status=SUSPENDED').expect(200)).body),
      ).toEqual(['C-000002']);
      const second = await list('?page=2&pageSize=2').expect(200);
      expect(second.body).toMatchObject({ total: 3, page: 2 });
      expect(numbers(second.body)).toEqual(['C-000001']);
    });

    it('refuses bad filters in French', async () => {
      const response = await list('?storeId=nope&status=CLOSED').expect(400);

      expect(response.body.details).toEqual([
        { field: 'storeId', errors: ['Identifiant de quincaillerie invalide'] },
        { field: 'status', errors: ['L’état doit être ACTIVE ou SUSPENDED'] },
      ]);
    });
  });

  describe('suspend and reactivate', () => {
    it('suspends with a reason, keeps who did it, and reactivates clearing it', async () => {
      const { id } = await account({
        number: 'C-000010',
        phone: '+22376000010',
      });

      const suspended = await suspend(id, {
        reason: '  Fraude suspectée  ',
      }).expect(200);
      expect(suspended.body).toMatchObject({
        id,
        status: 'SUSPENDED',
        statusReason: 'Fraude suspectée',
        statusChangedAt: expect.any(String) as string,
      });
      expect(JSON.stringify(suspended.body)).not.toContain(adminId);
      expect(
        await prisma.account.findUniqueOrThrow({ where: { id } }),
      ).toMatchObject({ status: 'SUSPENDED', statusChangedById: adminId });

      const active = await reactivate(id).expect(200);
      expect(active.body).toMatchObject({
        status: 'ACTIVE',
        statusReason: null,
      });
    });

    it('changes only that account, not the customer’s others', async () => {
      const here = await account({ number: 'C-000011', phone: '+22376000011' });
      const there = await account({
        number: 'C-000012',
        phone: '+22376000011',
        store: otherStoreId,
      });

      await suspend(here.id).expect(200);

      expect(
        (await prisma.account.findUniqueOrThrow({ where: { id: there.id } }))
          .status,
      ).toBe('ACTIVE');
    });

    it('refuses a repeated action', async () => {
      const { id } = await account({
        number: 'C-000013',
        phone: '+22376000013',
      });

      const notSuspended = await reactivate(id).expect(409);
      expect(notSuspended.body).toMatchObject({
        error: 'INVALID_STATUS_TRANSITION',
        message: 'Ce compte n’est pas suspendu',
      });
      await suspend(id).expect(200);
      const again = await suspend(id).expect(409);
      expect(again.body).toMatchObject({
        error: 'INVALID_STATUS_TRANSITION',
        message: 'Ce compte est déjà suspendu',
      });
    });

    it('refuses an account of a closed store', async () => {
      const closed = await createStoreRecord(prisma, {
        name: 'Fermée',
        status: 'CLOSED',
      });
      const { id } = await account({
        number: 'C-000014',
        phone: '+22376000014',
        store: closed.id,
      });

      const response = await suspend(id).expect(409);

      expect(response.body.error).toBe('STORE_CLOSED');
    });

    it.each([
      ['no reason', {}],
      ['a blank reason', { reason: '   ' }],
      ['a reason too long', { reason: 'x'.repeat(501) }],
      ['null', { reason: null }],
    ])('refuses %s', async (_label, body) => {
      const { id } = await account({
        number: 'C-000015',
        phone: '+22376000015',
      });

      const response = await suspend(id, body).expect(400);

      expect((response.body.details as { field: string }[])[0].field).toBe(
        'reason',
      );
      expect(
        (await prisma.account.findUniqueOrThrow({ where: { id } })).status,
      ).toBe('ACTIVE');
    });

    it('answers 404 for an unknown account and 400 for a malformed id', async () => {
      await suspend(UNKNOWN_ID).expect(404);
      await reactivate(UNKNOWN_ID).expect(404);
      await suspend('nope').expect(400);
    });
  });

  describe('the customer is told (16b)', () => {
    const notices = () =>
      prisma.notification.findMany({
        where: { type: { in: ['ACCOUNT_SUSPENDED', 'ACCOUNT_REACTIVATED'] } },
        orderBy: [{ createdAt: 'asc' }, { channel: 'asc' }],
      });
    /** The SMS rows are sent after the commit: wait for them to leave. */
    const settled = async () => {
      for (let i = 0; i < 100; i++) {
        if (
          (await prisma.notification.count({
            where: { status: 'PENDING' },
          })) === 0
        ) {
          return;
        }
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      throw new Error('Notifications still PENDING');
    };

    it('sends one notice per change, in the app and by SMS, never with the reason', async () => {
      const { id, customerId } = await account({
        number: 'C-000030',
        phone: '+22376000030',
      });

      await suspend(id, { reason: 'Fraude suspectée' }).expect(200);
      await reactivate(id).expect(200);
      await settled();

      const rows = await notices();
      expect(rows.map((r) => `${r.type} ${r.channel}`)).toEqual([
        'ACCOUNT_SUSPENDED APP',
        'ACCOUNT_SUSPENDED SMS',
        'ACCOUNT_REACTIVATED APP',
        'ACCOUNT_REACTIVATED SMS',
      ]);
      expect(rows.every((r) => r.userId === customerId)).toBe(true);
      expect(rows[0]).toMatchObject({ storeId, title: 'Compte suspendu' });
      expect(rows[0].body).toContain('C-000030');
      expect(rows[0].body).toContain('Quincaillerie du Carrefour');
      expect(rows[2].title).toBe('Compte réactivé');
      const texts = sms.messages.filter((m) => m.phone === '+22376000030');
      expect(texts).toHaveLength(2);
      expect(JSON.stringify([rows, texts])).not.toContain('Fraude');
    });

    it('sends nothing for a refused change', async () => {
      const { id } = await account({
        number: 'C-000031',
        phone: '+22376000031',
      });

      await reactivate(id).expect(409);
      await suspend(id, { reason: '' }).expect(400);

      expect(await notices()).toEqual([]);
    });
  });

  describe('permissions', () => {
    it('lets accounts.read search but not suspend', async () => {
      const { id } = await account({
        number: 'C-000020',
        phone: '+22376000020',
      });
      const reader = await signedIn(['accounts.read']);

      await list('', reader.cookie).expect(200);
      await suspend(id, undefined, reader.cookie).expect(403);
      await reactivate(id, reader.cookie).expect(403);
    });

    it('refuses an admin without the permissions', async () => {
      const { id } = await account({
        number: 'C-000021',
        phone: '+22376000021',
      });
      const other = await signedIn(['stores.read', 'stores.manage']);

      await list('', other.cookie).expect(403);
      await suspend(id, undefined, other.cookie).expect(403);
      expect(
        (await prisma.account.findUniqueOrThrow({ where: { id } })).status,
      ).toBe('ACTIVE');
    });

    it('refuses without a session', async () => {
      await request(app.getHttpServer())
        .get('/api/v1/admin/accounts')
        .expect(401);
    });
  });
});
