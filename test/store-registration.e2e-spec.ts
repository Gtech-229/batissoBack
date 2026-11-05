import type { INestApplication } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { DEFAULT_ARTICLE_CATEGORIES } from '../src/catalogue/default-categories.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { createTestApp } from './utils/app.js';
import { createMali, createStoreRecord } from './utils/countries.js';
import { resetDatabase } from './utils/reset-database.js';
import { signedInStaff, type MobileStaff } from './utils/staff.js';

/** A valid self-registration body (21b). */
function ownStoreBody(overrides: Record<string, unknown> = {}) {
  return {
    name: 'Quincaillerie Sanogo',
    address: 'Rue 7, Badalabougou',
    city: 'Bamako',
    phone: '20 22 11 11',
    tradeRegister: 'MA.BKO.2026.B.9876',
    settings: {
      maxBalance: '3000000',
      validationThreshold: '250000',
      minDeposit: '1000',
      terms: 'Dépôts non remboursables.',
      deliveryDelayDays: 20,
    },
    requestedPlan: 'STANDARD',
    ...overrides,
  };
}

describe('Store registration from the app (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let user: MobileStaff;

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
  });

  beforeEach(async () => {
    await resetDatabase(prisma);
    await createMali(prisma);
    user = await signedInStaff(app, prisma, {
      phone: '+22376123401',
      firstName: 'Ibrahim',
    });
  });

  afterAll(async () => {
    await app.close();
  });

  const api = () => request(app.getHttpServer());
  const register = (body: unknown = ownStoreBody(), as = user) =>
    api()
      .post('/api/v1/stores')
      .set('Authorization', as.authorization)
      .send(body as object);

  describe('POST /stores', () => {
    it('registers a PENDING store in the active country, the registrant its manager', async () => {
      const response = await register().expect(201);

      expect(response.body).toEqual({
        id: expect.any(String),
        name: 'Quincaillerie Sanogo',
        address: 'Rue 7, Badalabougou',
        city: 'Bamako',
        phone: '+22320221111',
        tradeRegister: 'MA.BKO.2026.B.9876',
        status: 'PENDING',
        country: {
          code: 'ML',
          name: 'Mali',
          currencyCode: 'XOF',
          currencySymbol: 'F CFA',
          decimals: 0,
        },
        settings: {
          maxBalance: '3000000',
          validationThreshold: '250000',
          minDeposit: '1000',
          refundAllowed: false,
          reservationEnabled: false,
          terms: 'Dépôts non remboursables.',
          deliveryDelayDays: 20,
        },
        requestedPlan: 'STANDARD',
        documents: { identity: false, tradeRegister: false },
        createdAt: expect.any(String),
      });

      const store = await prisma.hardwareStore.findUniqueOrThrow({
        where: { id: response.body.id as string },
        include: {
          members: true,
          categories: true,
          settings: true,
          subscriptions: true,
        },
      });
      expect(store).toMatchObject({
        countryCode: 'ML',
        status: 'PENDING',
        registeredById: user.userId,
        createdById: null,
        requestedPlan: 'STANDARD',
        managerIdPhotoPath: null,
        tradeRegisterPhotoPath: null,
      });
      expect(store.settings!.updatedById).toBeNull();
      expect(store.members).toEqual([
        expect.objectContaining({
          userId: user.userId,
          role: 'MANAGER',
          active: true,
        }),
      ]);
      expect(store.categories.map((c) => c.name).sort()).toEqual(
        [...DEFAULT_ARTICLE_CATEGORIES].sort(),
      );
      // No subscription at registration: admins record it by hand (16a).
      expect(store.subscriptions).toEqual([]);
    });

    it('lists the new store in GET /me, with the MANAGER role', async () => {
      const storeId = (await register().expect(201)).body.id as string;

      const me = await api()
        .get('/api/v1/me')
        .set('Authorization', user.authorization)
        .expect(200);

      expect(me.body.memberships).toEqual([
        { storeId, storeName: 'Quincaillerie Sanogo', role: 'MANAGER' },
      ]);
    });

    it('keeps the default delivery delay and no terms when they are left out', async () => {
      const response = await register(
        ownStoreBody({
          settings: {
            maxBalance: '2000000',
            validationThreshold: '200000',
            minDeposit: '500',
          },
        }),
      ).expect(201);

      expect(response.body.settings).toMatchObject({
        terms: null,
        deliveryDelayDays: 30,
      });
    });

    it('refuses a second registration with 409 STORE_ALREADY_REGISTERED, whatever the first store became', async () => {
      const storeId = (await register().expect(201)).body.id as string;
      await prisma.hardwareStore.update({
        where: { id: storeId },
        data: { status: 'CLOSED' },
      });

      const response = await register(
        ownStoreBody({ name: 'Deuxième quincaillerie' }),
      ).expect(409);

      expect(response.body).toMatchObject({
        error: 'STORE_ALREADY_REGISTERED',
        message:
          'Vous avez déjà inscrit une quincaillerie : chaque utilisateur ne peut en inscrire qu’une',
      });
      expect(await prisma.hardwareStore.count()).toBe(1);
    });

    it('lets only one of two parallel registrations by the same user through', async () => {
      const responses = await Promise.all([
        register(ownStoreBody({ name: 'Première' })),
        register(ownStoreBody({ name: 'Seconde' })),
      ]);

      expect(responses.map((r) => r.status).sort((a, b) => a - b)).toEqual([
        201, 409,
      ]);
      const refused = responses.find((r) => r.status === 409)!;
      expect(refused.body).toMatchObject({ error: 'STORE_ALREADY_REGISTERED' });
      expect(await prisma.hardwareStore.count()).toBe(1);
      expect(await prisma.storeMember.count()).toBe(1);
    });

    it('lets a manager of an admin-registered store register their own', async () => {
      const adminStore = await createStoreRecord(prisma, {
        status: 'VERIFIED',
      });
      const manager = await signedInStaff(app, prisma, {
        phone: '+22376451278',
        store: { id: adminStore.id, role: 'MANAGER' },
      });

      await register(ownStoreBody(), manager).expect(201);

      expect(
        await prisma.storeMember.count({ where: { userId: manager.userId } }),
      ).toBe(2);
    });

    it('lets two different users each register a store', async () => {
      const other = await signedInStaff(app, prisma, {
        phone: '+22376451278',
      });

      await register().expect(201);
      await register(ownStoreBody(), other).expect(201);

      expect(await prisma.hardwareStore.count()).toBe(2);
    });

    it('refuses with 409 NO_ACTIVE_COUNTRY when no country is active', async () => {
      await prisma.country.update({
        where: { code: 'ML' },
        data: { active: false },
      });

      const response = await register().expect(409);

      expect(response.body).toMatchObject({
        error: 'NO_ACTIVE_COUNTRY',
        message:
          'Aucun pays n’est ouvert pour le moment : l’inscription d’une quincaillerie est impossible',
      });
      expect(await prisma.hardwareStore.count()).toBe(0);
    });

    it('refuses a phone of another country, in French', async () => {
      const response = await register(
        ownStoreBody({ phone: '+221 77 123 45 67' }),
      ).expect(400);

      expect(response.body.details).toEqual([
        {
          field: 'phone',
          errors: ['Ce numéro n’est pas un numéro valide du pays ML'],
        },
      ]);
      expect(await prisma.hardwareStore.count()).toBe(0);
    });

    it('refuses a minimum deposit above the maximum balance', async () => {
      const response = await register(
        ownStoreBody({
          settings: {
            maxBalance: '1000',
            validationThreshold: '500',
            minDeposit: '5000',
          },
        }),
      ).expect(400);

      expect(response.body.details).toEqual([
        {
          field: 'settings.minDeposit',
          errors: ['Le dépôt minimum ne peut pas dépasser le solde maximal'],
        },
      ]);
    });

    it.each([
      ['an unknown plan', { requestedPlan: 'GOLD' }, 'requestedPlan'],
      ['a missing plan', { requestedPlan: undefined }, 'requestedPlan'],
      ['a null plan', { requestedPlan: null }, 'requestedPlan'],
      ['an empty name', { name: '  ' }, 'name'],
      ['missing settings', { settings: undefined }, 'settings'],
      [
        'a bad amount',
        {
          settings: {
            maxBalance: '-1',
            validationThreshold: '1',
            minDeposit: '1',
          },
        },
        'settings.maxBalance',
      ],
    ])('refuses %s in French', async (_, overrides, field) => {
      const response = await register(ownStoreBody(overrides)).expect(400);

      expect(response.body.details).toEqual(
        expect.arrayContaining([expect.objectContaining({ field })]),
      );
      expect(await prisma.hardwareStore.count()).toBe(0);
    });

    it('refuses the admin-only fields (country, manager)', async () => {
      const response = await register(
        ownStoreBody({
          countryCode: 'ML',
          manager: { firstName: 'X', lastName: 'Y', phone: '76 00 00 09' },
        }),
      ).expect(400);

      expect(
        response.body.details.map((d: { field: string }) => d.field),
      ).toEqual(expect.arrayContaining(['countryCode', 'manager']));
    });

    it('refuses a request without a session (401)', async () => {
      await api().post('/api/v1/stores').send(ownStoreBody()).expect(401);
      expect(await prisma.hardwareStore.count()).toBe(0);
    });

    it('takes no account and no deposit before an admin verifies the store', async () => {
      const storeId = (await register().expect(201)).body.id as string;

      const account = await api()
        .post(`/api/v1/stores/${storeId}/accounts`)
        .set('Authorization', user.authorization)
        .send({
          customer: {
            phone: '76 44 55 66',
            firstName: 'Fanta',
            lastName: 'Keita',
          },
          termsAccepted: true,
        })
        .expect(409);
      expect(account.body).toMatchObject({ error: 'STORE_NOT_VERIFIED' });

      const deposit = await api()
        .post(`/api/v1/stores/${storeId}/accounts/${randomUUID()}/deposits`)
        .set('Authorization', user.authorization)
        .set('Idempotency-Key', randomUUID())
        .send({ amount: '5000' })
        .expect(409);
      expect(deposit.body).toMatchObject({ error: 'STORE_NOT_VERIFIED' });
      expect(await prisma.operation.count()).toBe(0);
    });
  });
});
