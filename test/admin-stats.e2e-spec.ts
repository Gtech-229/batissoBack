import type { INestApplication } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import type { Permission } from '../src/admin-auth/permissions.js';
import type { Prisma } from '../src/generated/prisma/client.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { createAdmin } from './utils/admins.js';
import { accessCookieFor, createTestApp } from './utils/app.js';
import { createMali, createStoreRecord } from './utils/countries.js';
import { resetDatabase } from './utils/reset-database.js';
import { signedInStaff } from './utils/staff.js';

const OCTOBER = '?from=2026-10-01&to=2026-10-31';

/** The UTC day `offset` days from today. */
function day(offset: number): string {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + offset);
  return date.toISOString().slice(0, 10);
}
const midnight = (d: string) => new Date(`${d}T00:00:00.000Z`);
const NO_TRUST = {
  disputesOpened: 0,
  disputesUnresolved: 0,
  corrections: 0,
  ordersRefused: 0,
  closingsWithDiscrepancy: 0,
};

describe('Admin statistics (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let cookie: string;
  let openerId: string;

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
  });

  beforeEach(async () => {
    await resetDatabase(prisma);
    await createMali(prisma);
    await prisma.country.createMany({
      data: [
        {
          code: 'CI',
          name: 'Côte d’Ivoire',
          phonePrefix: '+225',
          currencyCode: 'XOF',
          currencySymbol: 'F CFA',
          decimals: 0,
          active: false,
        },
        // No store: never listed.
        {
          code: 'SN',
          name: 'Sénégal',
          phonePrefix: '+221',
          currencyCode: 'XOF',
          currencySymbol: 'F CFA',
          decimals: 0,
          active: false,
        },
      ],
    });
    openerId = (
      await prisma.user.create({
        data: { phone: '+22370000000', firstName: 'Vendeur', lastName: 'X' },
      })
    ).id;
    cookie = await signedIn(['stats.read']);
  });

  afterAll(async () => {
    await app.close();
  });

  async function signedIn(permissions: Permission[]) {
    const email = `a${Math.random().toString(36).slice(2, 8)}@batisso.test`;
    await createAdmin(prisma, { email, permissions });
    return accessCookieFor(app, email);
  }

  const stats = (query: string, as = cookie) =>
    request(app.getHttpServer())
      .get(`/api/v1/admin/stats${query}`)
      .set('Cookie', as);

  /** Inserts a customer and their account directly (fast setup). */
  let phoneSeq = 0;
  async function account(
    storeId: string,
    createdAt: string,
    status: 'ACTIVE' | 'SUSPENDED' = 'ACTIVE',
  ) {
    phoneSeq += 1;
    const customer = await prisma.user.create({
      data: {
        phone: `+2237600${String(phoneSeq).padStart(4, '0')}`,
        firstName: 'Client',
        lastName: 'K',
      },
    });
    return prisma.account.create({
      data: {
        number: `C-9${String(phoneSeq).padStart(5, '0')}`,
        customerId: customer.id,
        storeId,
        currencyCode: 'XOF',
        termsAcceptedAt: new Date(),
        openedById: openerId,
        status,
        createdAt: new Date(createdAt),
      },
    });
  }

  const subscription = (storeId: string, startsOn: string, endsOn: string) =>
    prisma.subscription.create({
      data: {
        storeId,
        plan: 'STANDARD',
        startsOn: midnight(startsOn),
        endsOn: midnight(endsOn),
      },
    });

  /**
   * Mali: a verified store registered in October with an active subscription,
   * a pending one registered in September with none, a suspended one
   * registered on October's last second with an expired one. Côte d'Ivoire: a
   * verified store registered in November with an upcoming subscription.
   */
  async function seed() {
    const a = await createStoreRecord(prisma, {
      status: 'VERIFIED',
      createdAt: new Date('2026-10-05T10:00:00Z'),
    });
    await createStoreRecord(prisma, {
      status: 'PENDING',
      createdAt: new Date('2026-09-30T23:59:59Z'),
    });
    const c = await createStoreRecord(prisma, {
      status: 'SUSPENDED',
      createdAt: new Date('2026-10-31T23:59:59Z'),
    });
    const d = await createStoreRecord(prisma, {
      status: 'VERIFIED',
      countryCode: 'CI',
      createdAt: new Date('2026-11-01T00:00:00Z'),
    });
    await subscription(a.id, day(-5), day(5));
    await subscription(c.id, day(-40), day(-10));
    await subscription(d.id, day(3), day(30));
    await account(a.id, '2026-10-01T00:00:00Z');
    await account(a.id, '2026-09-01T00:00:00Z', 'SUSPENDED');
    await account(d.id, '2026-10-15T00:00:00Z');
  }

  describe('GET /admin/stats: stores and accounts', () => {
    it('counts per country and for the platform, now and over the period', async () => {
      await seed();

      const response = await stats(OCTOBER).expect(200);

      const mali = {
        countryCode: 'ML',
        name: 'Mali',
        stores: {
          byStatus: { PENDING: 1, VERIFIED: 1, SUSPENDED: 1, CLOSED: 0 },
          bySubscription: { ACTIVE: 1, UPCOMING: 0, EXPIRED: 1, NONE: 1 },
          registered: 2,
        },
        accounts: { total: 2, suspended: 1, opened: 1, active: 0 },
        trust: NO_TRUST,
      };
      const ivoryCoast = {
        countryCode: 'CI',
        name: 'Côte d’Ivoire',
        stores: {
          byStatus: { PENDING: 0, VERIFIED: 1, SUSPENDED: 0, CLOSED: 0 },
          bySubscription: { ACTIVE: 0, UPCOMING: 1, EXPIRED: 0, NONE: 0 },
          registered: 0,
        },
        accounts: { total: 1, suspended: 0, opened: 1, active: 0 },
        trust: NO_TRUST,
      };
      expect(response.body).toEqual({
        period: { from: '2026-10-01', to: '2026-10-31' },
        platform: {
          stores: {
            byStatus: { PENDING: 1, VERIFIED: 2, SUSPENDED: 1, CLOSED: 0 },
            bySubscription: { ACTIVE: 1, UPCOMING: 1, EXPIRED: 1, NONE: 1 },
            registered: 2,
          },
          accounts: { total: 3, suspended: 1, opened: 2, active: 0 },
          trust: NO_TRUST,
        },
        countries: [ivoryCoast, mali],
      });
    });

    it('answers zeros and no country on an empty platform', async () => {
      const response = await stats(OCTOBER).expect(200);

      expect(response.body.countries).toEqual([]);
      expect(response.body.platform.accounts).toEqual({
        total: 0,
        suspended: 0,
        opened: 0,
        active: 0,
      });
    });

    it('counts an account active by a confirmed deposit inside the period only', async () => {
      const store = await createStoreRecord(prisma, { status: 'VERIFIED' });
      const seller = await signedInStaff(app, prisma, {
        phone: '+22376999999',
        store: { id: store.id, role: 'SELLER' },
      });
      const opened = await request(app.getHttpServer())
        .post(`/api/v1/stores/${store.id}/accounts`)
        .set('Authorization', seller.authorization)
        .send({
          customer: { phone: '76 44 55 66', firstName: 'Fanta', lastName: 'K' },
          termsAccepted: true,
        })
        .expect(201);
      await request(app.getHttpServer())
        .post(`/api/v1/stores/${store.id}/accounts/${opened.body.id}/deposits`)
        .set('Authorization', seller.authorization)
        .set('Idempotency-Key', randomUUID())
        .send({ amount: '5000' })
        .expect(201);

      const today = await stats(`?from=${day(-1)}&to=${day(0)}`).expect(200);
      const before = await stats(`?from=${day(-2)}&to=${day(-1)}`).expect(200);

      expect(today.body.platform.accounts).toMatchObject({
        opened: 1,
        active: 1,
      });
      expect(before.body.platform.accounts).toMatchObject({
        opened: 0,
        active: 0,
      });
      expect(JSON.stringify(today.body)).not.toMatch(/5000|Fanta|\+223/);
    });
  });

  describe('GET /admin/stats: trust signals', () => {
    /**
     * In one verified store of Mali, through the real routes: a deposit, its
     * correction, and the customer's dispute, all today; then, inserted
     * directly, an order the manager refused today and one the customer
     * refused two days ago, and two cash closings today (one with a gap).
     */
    async function trustSeed() {
      const store = await createStoreRecord(prisma, { status: 'VERIFIED' });
      const manager = await signedInStaff(app, prisma, {
        phone: '+22376000100',
        store: { id: store.id, role: 'MANAGER' },
      });
      const seller = await signedInStaff(app, prisma, {
        phone: '+22376000101',
        store: { id: store.id, role: 'SELLER' },
      });
      const customer = await signedInStaff(app, prisma, {
        phone: '+22376000102',
      });
      const api = () => request(app.getHttpServer());
      const accountId = (
        await api()
          .post(`/api/v1/stores/${store.id}/accounts`)
          .set('Authorization', seller.authorization)
          .send({
            customer: { phone: customer.phone, firstName: 'F', lastName: 'K' },
            termsAccepted: true,
          })
          .expect(201)
      ).body.id as string;
      const deposit = (
        await api()
          .post(`/api/v1/stores/${store.id}/accounts/${accountId}/deposits`)
          .set('Authorization', seller.authorization)
          .set('Idempotency-Key', randomUUID())
          .send({ amount: '5000' })
          .expect(201)
      ).body.id as string;
      await api()
        .post(
          `/api/v1/stores/${store.id}/accounts/${accountId}/operations/${deposit}/corrections`,
        )
        .set('Authorization', manager.authorization)
        .set('Idempotency-Key', randomUUID())
        .send({ amount: '1000', reason: 'Erreur de saisie' })
        .expect(201);
      await api()
        .post(`/api/v1/me/accounts/${accountId}/operations/${deposit}/disputes`)
        .set('Authorization', customer.authorization)
        .send({ message: 'Je n’ai pas versé ce montant' })
        .expect(201);

      const goal = await prisma.goal.findFirstOrThrow({
        where: { accountId, isSystem: true },
      });
      const order = (
        reference: string,
        data: Pick<Prisma.MaterialOrderUncheckedCreateInput, 'status'> &
          Partial<Prisma.MaterialOrderUncheckedCreateInput>,
      ) =>
        prisma.materialOrder.create({
          data: {
            reference,
            storeId: store.id,
            accountId,
            goalId: goal.id,
            total: 20000n,
            createdById: seller.userId,
            ...data,
          },
        });
      await order('B-90001', {
        status: 'REFUSED_BY_MANAGER',
        refusedAt: new Date(),
        refusedById: manager.userId,
        refusalReason: 'Rupture',
      });
      await order('B-90002', {
        status: 'REFUSED_BY_CUSTOMER',
        customerRefusedAt: new Date(`${day(-2)}T10:00:00.000Z`),
      });
      await order('B-90003', { status: 'AWAITING_CUSTOMER' });

      const closing = (counted: bigint) =>
        prisma.cashClosing.create({
          data: {
            storeId: store.id,
            managerId: manager.userId,
            currencyCode: 'XOF',
            depositsTotal: 5000n,
            correctionsTotal: 1000n,
            expectedTotal: 4000n,
            countedTotal: counted,
            discrepancy: counted - 4000n,
            justification: counted === 4000n ? null : 'Billet manquant',
            idempotencyKey: randomUUID(),
          },
        });
      await closing(3500n);
      await closing(4000n);
    }

    it('counts each signal inside the period, in its store’s country', async () => {
      await trustSeed();

      const today = await stats(`?from=${day(0)}&to=${day(0)}`).expect(200);

      const mali = (today.body.countries as { countryCode: string }[]).find(
        (c) => c.countryCode === 'ML',
      );
      expect(mali).toMatchObject({
        trust: {
          disputesOpened: 1,
          disputesUnresolved: 1,
          corrections: 1,
          ordersRefused: 1,
          closingsWithDiscrepancy: 1,
        },
      });
      expect(today.body.platform.trust).toEqual(
        (mali as unknown as { trust: object }).trust,
      );
    });

    it('counts only what happened in another period, but the unresolved disputes as of now', async () => {
      await trustSeed();

      const before = await stats(`?from=${day(-2)}&to=${day(-1)}`).expect(200);

      expect(before.body.platform.trust).toEqual({
        disputesOpened: 0,
        disputesUnresolved: 1,
        corrections: 0,
        ordersRefused: 1,
        closingsWithDiscrepancy: 0,
      });
      expect(JSON.stringify(before.body)).not.toMatch(/Rupture|Billet|\+223/);
    });
  });

  describe('the period', () => {
    it.each([
      ['no period', ''],
      ['no end', '?from=2026-10-01'],
      ['an impossible day', '?from=2026-02-30&to=2026-03-01'],
      ['year 0000', '?from=0000-01-01&to=0000-01-31'],
    ])('refuses %s in French', async (_label, query) => {
      const response = await stats(query).expect(400);

      expect(response.body.details.length).toBeGreaterThan(0);
    });

    it.each([
      ['an end before the start', '?from=2026-10-31&to=2026-10-01'],
      ['more than 366 days', '?from=2025-01-01&to=2026-02-01'],
    ])('refuses %s like the store reports', async (_label, query) => {
      const response = await stats(query).expect(400);

      expect(response.body.details).toEqual([
        {
          field: 'to',
          errors: [
            'La période doit aller de la première date à la seconde, 366 jours au plus',
          ],
        },
      ]);
    });
  });

  describe('permissions', () => {
    it('refuses an admin without stats.read, and without a session', async () => {
      const other = await signedIn(['stores.read', 'subscriptions.read']);

      await stats(OCTOBER, other).expect(403);
      await request(app.getHttpServer())
        .get(`/api/v1/admin/stats${OCTOBER}`)
        .expect(401);
    });
  });
});
