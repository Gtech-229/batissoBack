import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { createAdmin } from './utils/admins.js';
import { accessCookieFor, createTestApp } from './utils/app.js';
import { createMali, createStoreRecord } from './utils/countries.js';
import { resetDatabase } from './utils/reset-database.js';

describe('Stores: list and updates (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let cookie: string;
  let adminId: string;

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
  });

  beforeEach(async () => {
    await resetDatabase(prisma);
    const admin = await createAdmin(prisma, { email: 'awa@batisso.test' });
    adminId = admin.id;
    cookie = await accessCookieFor(app, 'awa@batisso.test');
    await createMali(prisma);
  });

  afterAll(async () => {
    await app.close();
  });

  const api = () => request(app.getHttpServer());
  const list = (query = '') =>
    api().get(`/api/v1/admin/stores${query}`).set('Cookie', cookie);

  describe('GET /admin/stores', () => {
    async function seed() {
      const day = (n: number) => new Date(Date.UTC(2026, 9, n));
      await createStoreRecord(prisma, {
        name: 'Quincaillerie du Carrefour',
        city: 'Bamako',
        status: 'VERIFIED',
        createdAt: day(1),
      });
      await createStoreRecord(prisma, {
        name: 'Matériaux Diallo',
        city: 'Kayes',
        status: 'PENDING',
        createdAt: day(2),
      });
      await createStoreRecord(prisma, {
        name: 'Le Bon Ciment',
        city: 'Ségou',
        status: 'CLOSED',
        createdAt: day(3),
      });
    }

    it('paginates newest first with the default page size', async () => {
      await seed();

      const response = await list().expect(200);

      expect(response.body).toMatchObject({ total: 3, page: 1, pageSize: 20 });
      expect(response.body.items.map((s: { name: string }) => s.name)).toEqual([
        'Le Bon Ciment',
        'Matériaux Diallo',
        'Quincaillerie du Carrefour',
      ]);
      expect(response.body.items[0]).toEqual({
        id: expect.any(String),
        name: 'Le Bon Ciment',
        city: 'Ségou',
        countryCode: 'ML',
        phone: '+22320220000',
        status: 'CLOSED',
        createdAt: '2026-10-03T00:00:00.000Z',
        subscriptionState: 'NONE',
        currentSubscription: null,
      });
    });

    it('splits into pages and keeps the real total past the end', async () => {
      await seed();

      const second = await list('?page=2&pageSize=2').expect(200);
      expect(second.body).toMatchObject({ total: 3, page: 2, pageSize: 2 });
      expect(second.body.items).toHaveLength(1);

      const beyond = await list('?page=9&pageSize=2').expect(200);
      expect(beyond.body).toMatchObject({ items: [], total: 3 });
    });

    it.each([
      ['?status=PENDING', ['Matériaux Diallo']],
      [
        '?countryCode=ml',
        ['Le Bon Ciment', 'Matériaux Diallo', 'Quincaillerie du Carrefour'],
      ],
      ['?q=CARREFOUR', ['Quincaillerie du Carrefour']],
      ['?q=kay', ['Matériaux Diallo']],
      ['?q=ségou', ['Le Bon Ciment']],
      ['?status=VERIFIED&q=diallo', []],
    ])('filters with %s', async (query, names) => {
      await seed();

      const response = await list(query).expect(200);

      expect(response.body.items.map((s: { name: string }) => s.name)).toEqual(
        names,
      );
      expect(response.body.total).toBe(names.length);
    });

    it.each([
      ['_', ['Depot_Sud 100%']],
      ['%', ['Depot_Sud 100%']],
      ['100%', ['Depot_Sud 100%']],
      // As a pattern, `l_r` would match "Quincail-ler-ie".
      ['l_r', []],
      ['\\', []],
      ['quincaillerie', ['Quincaillerie A']],
    ])('searches q=%j literally, not as a LIKE pattern', async (q, names) => {
      await createStoreRecord(prisma, { name: 'Quincaillerie A' });
      await createStoreRecord(prisma, { name: 'Depot_Sud 100%' });

      const response = await list(`?q=${encodeURIComponent(q)}`).expect(200);

      expect(response.body.items.map((s: { name: string }) => s.name)).toEqual(
        names,
      );
    });

    it.each([
      ['?pageSize=101', 'pageSize'],
      ['?page=0', 'page'],
      ['?page=100000000000000000000', 'page'],
      ['?status=OPEN', 'status'],
      ['?countryCode=XX', 'countryCode'],
      ['?q=', 'q'],
      ['?sort=name', 'sort'],
    ])('rejects %s', async (query, field) => {
      const response = await list(query).expect(400);

      expect(
        response.body.details.map((d: { field: string }) => d.field),
      ).toEqual([field]);
    });
  });

  describe('PATCH /admin/stores/:id', () => {
    const update = (id: string, body: object) =>
      api()
        .patch(`/api/v1/admin/stores/${id}`)
        .set('Cookie', cookie)
        .send(body);

    it('changes only the fields sent and normalizes the phone', async () => {
      const store = await createStoreRecord(prisma);

      const response = await update(store.id, {
        name: '  Quincaillerie Centrale ',
        phone: '20 22 11 11',
      }).expect(200);

      expect(response.body).toMatchObject({
        name: 'Quincaillerie Centrale',
        phone: '+22320221111',
        city: 'Bamako',
        tradeRegister: 'MA.BKO.2026.B.1234',
        status: 'PENDING',
      });
    });

    it('rejects a phone of another country', async () => {
      const store = await createStoreRecord(prisma);

      const response = await update(store.id, {
        phone: '+225 07 00 00 00 00',
      }).expect(400);
      expect(response.body.details).toEqual([
        {
          field: 'phone',
          errors: ['Ce numéro n’est pas un numéro valide du pays ML'],
        },
      ]);
    });

    it('refuses fields that are not store information', async () => {
      const store = await createStoreRecord(prisma);

      const response = await update(store.id, {
        status: 'VERIFIED',
        countryCode: 'CI',
      }).expect(400);
      const fields = response.body.details
        .map((d: { field: string }) => d.field)
        .sort();
      expect(fields).toEqual(['countryCode', 'status']);
    });

    it('refuses a closed store', async () => {
      const store = await createStoreRecord(prisma, { status: 'CLOSED' });

      const response = await update(store.id, { name: 'Nouveau nom' }).expect(
        409,
      );
      expect(response.body.error).toBe('STORE_CLOSED');
    });

    it('answers 404 for an unknown store', async () => {
      await update('0192f0a4-7b1c-7c3e-9d2a-5e6f7a8b9c0d', {
        name: 'X',
      }).expect(404);
    });

    it.each(['name', 'address', 'city', 'phone', 'tradeRegister'])(
      'refuses null for %s with a 400',
      async (field) => {
        const store = await createStoreRecord(prisma);

        const response = await update(store.id, { [field]: null }).expect(400);

        expect(
          response.body.details.map((d: { field: string }) => d.field),
        ).toEqual([field]);
      },
    );
  });

  describe('PATCH /admin/stores/:id/settings', () => {
    const updateSettings = (id: string, body: object) =>
      api()
        .patch(`/api/v1/admin/stores/${id}/settings`)
        .set('Cookie', cookie)
        .send(body);

    it('changes only the amounts sent, as strings, and records who', async () => {
      const store = await createStoreRecord(prisma);

      const response = await updateSettings(store.id, {
        validationThreshold: '300000',
        terms: 'Pas de remboursement en espèces.',
      }).expect(200);

      expect(response.body.settings).toEqual({
        maxBalance: '2000000',
        validationThreshold: '300000',
        minDeposit: '500',
        refundAllowed: false,
        reservationEnabled: false,
        terms: 'Pas de remboursement en espèces.',
        deliveryDelayDays: 30,
      });
      const settings = await prisma.storeSettings.findUniqueOrThrow({
        where: { storeId: store.id },
      });
      expect(settings.updatedById).toBe(adminId);
    });

    it('clears the terms with null', async () => {
      const store = await createStoreRecord(prisma);
      await updateSettings(store.id, { terms: 'Conditions' }).expect(200);

      const response = await updateSettings(store.id, { terms: null }).expect(
        200,
      );
      expect(response.body.settings.terms).toBeNull();
    });

    it('changes the delivery delay and keeps it', async () => {
      const store = await createStoreRecord(prisma);

      const response = await updateSettings(store.id, {
        deliveryDelayDays: 45,
      }).expect(200);

      expect(response.body.settings).toMatchObject({
        deliveryDelayDays: 45,
        maxBalance: '2000000',
      });
      expect(
        (
          await prisma.storeSettings.findUniqueOrThrow({
            where: { storeId: store.id },
          })
        ).deliveryDelayDays,
      ).toBe(45);
    });

    it.each([0, 366, 2.5, '30', null])(
      'refuses a delivery delay of %s with a French 400',
      async (deliveryDelayDays) => {
        const store = await createStoreRecord(prisma);

        const response = await updateSettings(store.id, {
          deliveryDelayDays,
        }).expect(400);

        expect(response.body.details).toEqual([
          {
            field: 'deliveryDelayDays',
            errors: [
              'Le délai de livraison doit être un nombre entier de jours, de 1 à 365',
            ],
          },
        ]);
      },
    );

    it.each(['maxBalance', 'validationThreshold', 'minDeposit'])(
      'refuses null for %s with a 400',
      async (field) => {
        const store = await createStoreRecord(prisma);

        const response = await updateSettings(store.id, {
          [field]: null,
        }).expect(400);

        expect(
          response.body.details.map((d: { field: string }) => d.field),
        ).toEqual([field]);
      },
    );

    it('checks the minimum deposit against the merged values', async () => {
      // Current: maxBalance 2 000 000, minDeposit 500.
      const store = await createStoreRecord(prisma);

      const lowerMax = await updateSettings(store.id, {
        maxBalance: '400',
      }).expect(400);
      expect(lowerMax.body.details).toEqual([
        {
          field: 'maxBalance',
          errors: ['Le dépôt minimum ne peut pas dépasser le solde maximal'],
        },
      ]);

      const higherMin = await updateSettings(store.id, {
        minDeposit: '3000000',
      }).expect(400);
      expect(higherMin.body.details[0].field).toBe('minDeposit');

      // Both moving together is fine when consistent.
      await updateSettings(store.id, {
        maxBalance: '400',
        minDeposit: '100',
      }).expect(200);
    });

    it('refuses refunds and reservations (forced off in V1)', async () => {
      const store = await createStoreRecord(prisma);

      const response = await updateSettings(store.id, {
        refundAllowed: true,
      }).expect(400);
      expect(response.body.details[0].field).toBe('refundAllowed');
    });

    it('refuses a closed store', async () => {
      const store = await createStoreRecord(prisma, { status: 'CLOSED' });

      const response = await updateSettings(store.id, {
        minDeposit: '1000',
      }).expect(409);
      expect(response.body.error).toBe('STORE_CLOSED');
    });
  });
});
