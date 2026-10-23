import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { DEFAULT_ARTICLE_CATEGORIES } from '../src/catalogue/default-categories.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { createAdmin } from './utils/admins.js';
import { accessCookieFor, createTestApp } from './utils/app.js';
import { createMali, storeBody } from './utils/countries.js';
import { resetDatabase } from './utils/reset-database.js';

const UNKNOWN_ID = '0192f0a4-7b1c-7c3e-9d2a-5e6f7a8b9c0d';

describe('Stores (e2e)', () => {
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
  });

  afterAll(async () => {
    await app.close();
  });

  const api = () => request(app.getHttpServer());
  const register = (body: object) =>
    api().post('/api/v1/admin/stores').set('Cookie', cookie).send(body);

  describe('POST /admin/stores', () => {
    it('registers a pending store with its settings and a new manager', async () => {
      await createMali(prisma);

      const response = await register(storeBody()).expect(201);

      expect(response.body).toMatchObject({
        name: 'Quincaillerie du Carrefour',
        phone: '+22320220000',
        status: 'PENDING',
        verifiedAt: null,
        statusReason: null,
        country: { code: 'ML', currencyCode: 'XOF', decimals: 0 },
        // Amounts travel as strings of the smallest unit.
        settings: {
          maxBalance: '2000000',
          validationThreshold: '200000',
          minDeposit: '500',
          refundAllowed: false,
          reservationEnabled: false,
          terms: null,
        },
        managers: [
          { firstName: 'Awa', lastName: 'Diallo', phone: '+22376000000' },
        ],
      });

      const store = await prisma.hardwareStore.findUniqueOrThrow({
        where: { id: response.body.id },
        include: { settings: true, members: true, categories: true },
      });
      expect(store.createdById).toBe(adminId);
      expect(store.settings?.maxBalance).toBe(2000000n);
      expect(store.members).toEqual([
        expect.objectContaining({ role: 'MANAGER', active: true }),
      ]);
      // The store starts with the default catalogue categories.
      expect(store.categories.map((category) => category.name).sort()).toEqual(
        [...DEFAULT_ARTICLE_CATEGORIES].sort(),
      );
    });

    it('reuses an existing person as manager without renaming them', async () => {
      await createMali(prisma);
      const existing = await prisma.user.create({
        data: {
          phone: '+22376000000',
          firstName: 'Aminata',
          lastName: 'Keita',
        },
      });

      const response = await register(storeBody()).expect(201);

      expect(response.body.managers).toEqual([
        {
          userId: existing.id,
          firstName: 'Aminata',
          lastName: 'Keita',
          phone: '+22376000000',
        },
      ]);
      expect(await prisma.user.count()).toBe(1);
    });

    it('registers stores in parallel with the same new manager phone', async () => {
      await createMali(prisma);

      const responses = await Promise.all(
        Array.from({ length: 6 }, () => register(storeBody())),
      );

      expect(responses.map((r) => r.status)).toEqual(Array(6).fill(201));
      const users = await prisma.user.findMany();
      expect(users).toHaveLength(1);
      const managerIds = responses.map((r) => r.body.managers[0].userId);
      expect(new Set(managerIds)).toEqual(new Set([users[0].id]));
      expect(await prisma.hardwareStore.count()).toBe(6);
    });

    it('refuses an inactive country', async () => {
      await createMali(prisma, false);

      const response = await register(storeBody()).expect(409);

      expect(response.body.error).toBe('COUNTRY_INACTIVE');
      expect(await prisma.hardwareStore.count()).toBe(0);
    });

    it('answers 404 for an unknown country', async () => {
      const response = await register(storeBody()).expect(404);

      expect(response.body.message).toBe('Pays introuvable');
    });

    it('rejects phone numbers of another country and creates nothing', async () => {
      await createMali(prisma);

      const response = await register(
        storeBody({
          phone: '+225 07 00 00 00 00',
          manager: {
            firstName: 'Awa',
            lastName: 'Diallo',
            phone: '+225 07 00 00 00 01',
          },
        }),
      ).expect(400);

      expect(response.body.details).toEqual([
        {
          field: 'phone',
          errors: ['Ce numéro n’est pas un numéro valide du pays ML'],
        },
        {
          field: 'manager.phone',
          errors: ['Ce numéro n’est pas un numéro valide du pays ML'],
        },
      ]);
      expect(await prisma.user.count()).toBe(0);
      expect(await prisma.hardwareStore.count()).toBe(0);
    });

    it('rejects a minimum deposit above the maximum balance', async () => {
      await createMali(prisma);

      const response = await register(
        storeBody({
          settings: {
            maxBalance: '1000',
            validationThreshold: '200000',
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

    it('validates nested fields with their full path, in French', async () => {
      await createMali(prisma);

      const response = await register(
        storeBody({
          settings: {
            maxBalance: 2000000,
            validationThreshold: '0',
            minDeposit: '500.5',
          },
          manager: { firstName: '', lastName: 'Diallo', phone: '76 00 00 00' },
        }),
      ).expect(400);

      const fields = (response.body.details as { field: string }[])
        .map((d) => d.field)
        .sort();
      expect(fields).toEqual([
        'manager.firstName',
        'settings.maxBalance',
        'settings.minDeposit',
        'settings.validationThreshold',
      ]);
      expect(JSON.stringify(response.body.details)).toMatch(
        /entier positif écrit en chiffres/,
      );
    });

    it('requires the settings and the manager', async () => {
      await createMali(prisma);
      const body = storeBody();
      delete (body as Partial<typeof body>).settings;
      delete (body as Partial<typeof body>).manager;

      const response = await register(body).expect(400);

      expect(response.body.details).toEqual(
        expect.arrayContaining([
          {
            field: 'settings',
            errors: [
              'Les paramètres de la quincaillerie sont requis, sous forme d’objet',
            ],
          },
          {
            field: 'manager',
            errors: ['Le gérant est requis, sous forme d’objet'],
          },
        ]),
      );
    });

    it.each([
      ['settings', []],
      ['settings', [storeBody().settings]],
      ['settings', 'x'],
      ['manager', []],
      ['manager', 42],
    ])(
      'refuses %s sent as %j with a French 400 and creates nothing',
      async (field, value) => {
        await createMali(prisma);

        const response = await register(storeBody({ [field]: value })).expect(
          400,
        );

        const details = response.body.details as {
          field: string;
          errors: string[];
        }[];
        expect(details.map((d) => d.field)).toEqual([field]);
        // French only: none of class-validator's default English messages.
        expect(details[0].errors.join(' ')).not.toMatch(
          /must|should|nested property/,
        );
        expect(await prisma.hardwareStore.count()).toBe(0);
      },
    );

    it('refuses an unknown field, even nested', async () => {
      await createMali(prisma);

      const response = await register(
        storeBody({
          status: 'VERIFIED',
          settings: {
            maxBalance: '2000000',
            validationThreshold: '200000',
            minDeposit: '500',
            refundAllowed: true,
          },
        }),
      ).expect(400);

      const fields = (response.body.details as { field: string }[])
        .map((d) => d.field)
        .sort();
      expect(fields).toEqual(['settings.refundAllowed', 'status']);
    });

    it('never lets a registration and a deactivation of the country both succeed', async () => {
      for (let round = 0; round < 5; round++) {
        await resetDatabase(prisma);
        await createAdmin(prisma, { email: 'awa@batisso.test' });
        cookie = await accessCookieFor(app, 'awa@batisso.test');
        await createMali(prisma);

        const [registration, deactivation] = await Promise.all([
          register(storeBody()),
          api()
            .patch('/api/v1/admin/countries/ML/deactivate')
            .set('Cookie', cookie),
        ]);

        const country = await prisma.country.findUniqueOrThrow({
          where: { code: 'ML' },
        });
        const stores = await prisma.hardwareStore.count();
        if (registration.status === 201) {
          // The store exists, so the country had to stay active.
          expect(deactivation.status).toBe(409);
          expect(country.active).toBe(true);
          expect(stores).toBe(1);
        } else {
          expect(registration.body.error).toBe('COUNTRY_INACTIVE');
          expect(deactivation.status).toBe(200);
          expect(stores).toBe(0);
        }
      }
    });

    it('requires a session', async () => {
      await api().post('/api/v1/admin/stores').send(storeBody()).expect(401);
    });
  });

  describe('GET /admin/stores/:id', () => {
    it('returns the store detail with amounts as strings', async () => {
      await createMali(prisma);
      const created = await register(storeBody()).expect(201);

      const response = await api()
        .get(`/api/v1/admin/stores/${created.body.id}`)
        .set('Cookie', cookie)
        .expect(200);

      expect(response.body).toEqual(created.body);
      expect(typeof response.body.settings.maxBalance).toBe('string');
    });

    it('answers 404 for an unknown id and a French 400 for a malformed one', async () => {
      const unknown = await api()
        .get(`/api/v1/admin/stores/${UNKNOWN_ID}`)
        .set('Cookie', cookie)
        .expect(404);
      expect(unknown.body.message).toBe('Quincaillerie introuvable');

      const malformed = await api()
        .get('/api/v1/admin/stores/not-a-uuid')
        .set('Cookie', cookie)
        .expect(400);
      expect(malformed.body.message).toBe(
        'Identifiant de quincaillerie invalide',
      );
    });
  });
});
