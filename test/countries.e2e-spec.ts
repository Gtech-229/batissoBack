import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { createAdmin } from './utils/admins.js';
import { accessCookieFor, createTestApp } from './utils/app.js';
import { resetDatabase } from './utils/reset-database.js';

const MALI = {
  code: 'ML',
  name: 'Mali',
  currencyCode: 'XOF',
  currencySymbol: 'F CFA',
  decimals: 0,
};
const IVORY_COAST = { ...MALI, code: 'CI', name: 'Côte d’Ivoire' };

describe('Countries (e2e)', () => {
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
  const create = (body: object) =>
    api().post('/api/v1/admin/countries').set('Cookie', cookie).send(body);
  const action = (code: string, verb: 'activate' | 'deactivate') =>
    api()
      .patch(`/api/v1/admin/countries/${code}/${verb}`)
      .set('Cookie', cookie);

  async function addStore(countryCode: string, status: 'PENDING' | 'CLOSED') {
    await prisma.hardwareStore.create({
      data: {
        countryCode,
        name: 'Quincaillerie du Carrefour',
        address: 'Rue 12',
        city: 'Bamako',
        phone: '+22370000000',
        tradeRegister: 'MA.BKO.2026.B.1234',
        status,
        createdById: adminId,
      },
    });
  }

  it('refuses every route without a session', async () => {
    await api().post('/api/v1/admin/countries').send(MALI).expect(401);
    await api().patch('/api/v1/admin/countries/ML/activate').expect(401);
  });

  it('creates an inactive country with the phone prefix derived from its code', async () => {
    const response = await create({ ...MALI, code: ' ml ' }).expect(201);

    expect(response.body).toMatchObject({
      code: 'ML',
      phonePrefix: '+223',
      currencyCode: 'XOF',
      active: false,
    });
  });

  describe('create', () => {
    it('refuses a duplicate code', async () => {
      await create(MALI).expect(201);

      const response = await create({ ...MALI, code: 'ml' }).expect(409);
      expect(response.body).toMatchObject({
        error: 'COUNTRY_ALREADY_EXISTS',
        message: 'Un pays avec ce code existe déjà',
      });
    });

    it('refuses an ISO code without a phone prefix (Antarctica)', async () => {
      const response = await create({ ...MALI, code: 'AQ' }).expect(400);

      expect(response.body.message).toMatch(/AQ n’est pas pris en charge/);
    });

    it('validates every field with French messages', async () => {
      const response = await create({
        code: 'XX',
        name: '  ',
        currencyCode: 'EURO',
        currencySymbol: '',
        decimals: 4,
        language: 'de',
      }).expect(400);

      const fields = (response.body.details as { field: string }[])
        .map((d) => d.field)
        .sort();
      expect(fields).toEqual(
        [
          'code',
          'currencyCode',
          'currencySymbol',
          'decimals',
          'language',
          'name',
        ].sort(),
      );
      expect(JSON.stringify(response.body.details)).not.toMatch(
        /must be|should/,
      );
    });

    it('defaults the language to fr', async () => {
      const response = await create(MALI).expect(201);

      expect(response.body.language).toBe('fr');
    });

    it('refuses a null language (only omitting it gives the default)', async () => {
      const response = await create({ ...MALI, language: null }).expect(400);

      expect(response.body.details).toEqual([
        { field: 'language', errors: ['La langue doit être fr ou en'] },
      ]);
    });
  });

  describe('list and read', () => {
    it('lists countries in code order', async () => {
      await create(MALI).expect(201);
      await create(IVORY_COAST).expect(201);

      const response = await api()
        .get('/api/v1/admin/countries')
        .set('Cookie', cookie)
        .expect(200);

      expect(response.body.map((c: { code: string }) => c.code)).toEqual([
        'CI',
        'ML',
      ]);
    });

    it('reads one country by code, any case, and 404s in French', async () => {
      await create(MALI).expect(201);

      const found = await api()
        .get('/api/v1/admin/countries/ml')
        .set('Cookie', cookie)
        .expect(200);
      expect(found.body.name).toBe('Mali');

      const missing = await api()
        .get('/api/v1/admin/countries/ZZ')
        .set('Cookie', cookie)
        .expect(404);
      expect(missing.body.message).toBe('Pays introuvable');
    });
  });

  describe('update', () => {
    const update = (code: string, body: object) =>
      api()
        .patch(`/api/v1/admin/countries/${code}`)
        .set('Cookie', cookie)
        .send(body);

    it('changes only the fields sent', async () => {
      await create(MALI).expect(201);

      const response = await update('ML', {
        name: 'République du Mali',
      }).expect(200);

      expect(response.body).toMatchObject({
        name: 'République du Mali',
        currencyCode: 'XOF',
        currencySymbol: 'F CFA',
        decimals: 0,
        language: 'fr',
        active: false,
      });
    });

    it('refuses to change the code', async () => {
      await create(MALI).expect(201);

      const response = await update('ML', { code: 'CI' }).expect(400);
      expect(response.body.details).toEqual([
        { field: 'code', errors: ["Ce champ n'est pas autorisé"] },
      ]);
    });

    it('lets the currency change while the country has no store', async () => {
      await create(MALI).expect(201);

      const response = await update('ML', {
        currencyCode: 'xaf',
        decimals: 2,
      }).expect(200);
      expect(response.body).toMatchObject({ currencyCode: 'XAF', decimals: 2 });
    });

    it('freezes the currency once a store exists, even a closed one', async () => {
      await create(MALI).expect(201);
      await addStore('ML', 'CLOSED');

      for (const body of [{ currencyCode: 'XAF' }, { decimals: 2 }]) {
        const response = await update('ML', body).expect(409);
        expect(response.body).toMatchObject({
          error: 'COUNTRY_IN_USE',
          message:
            'La devise d’un pays qui a des quincailleries ne peut plus changer',
        });
      }
      // Re-sending the same values, or other fields, is still fine.
      await update('ML', {
        currencyCode: 'XOF',
        decimals: 0,
        currencySymbol: 'FCFA',
      }).expect(200);
    });

    it('answers 404 for an unknown code', async () => {
      await update('ZZ', { name: 'Nulle part' }).expect(404);
    });

    it.each(['name', 'currencyCode', 'decimals', 'language'])(
      'refuses null for %s with a 400, even when a store exists',
      async (field) => {
        await create(MALI).expect(201);
        await addStore('ML', 'PENDING');

        const response = await update('ML', { [field]: null }).expect(400);

        expect(
          response.body.details.map((d: { field: string }) => d.field),
        ).toEqual([field]);
      },
    );
  });

  describe('activate', () => {
    it('activates a country, case-insensitive code, and is idempotent', async () => {
      await create(MALI).expect(201);

      const first = await action('ml', 'activate').expect(200);
      expect(first.body.active).toBe(true);

      const again = await action('ML', 'activate').expect(200);
      expect(again.body.active).toBe(true);
    });

    it('refuses a second active country and names the active one', async () => {
      await create(MALI).expect(201);
      await create(IVORY_COAST).expect(201);
      await action('ML', 'activate').expect(200);

      const response = await action('CI', 'activate').expect(409);

      expect(response.body).toMatchObject({
        error: 'ANOTHER_COUNTRY_ACTIVE',
        message: 'Le pays ML est déjà actif : désactivez-le d’abord',
      });
      expect(await prisma.country.count({ where: { active: true } })).toBe(1);
    });

    it('keeps a single active country when two activations race', async () => {
      await create(MALI).expect(201);
      await create(IVORY_COAST).expect(201);

      const responses = await Promise.all([
        action('ML', 'activate'),
        action('CI', 'activate'),
      ]);

      expect(responses.map((r) => r.status).sort((a, b) => a - b)).toEqual([
        200, 409,
      ]);
      expect(await prisma.country.count({ where: { active: true } })).toBe(1);
    });

    it('answers 404 for an unknown code', async () => {
      await action('ZZ', 'activate').expect(404);
    });
  });

  describe('deactivate', () => {
    it('deactivates a country without open stores, and is idempotent', async () => {
      await create(MALI).expect(201);
      await action('ML', 'activate').expect(200);

      const response = await action('ML', 'deactivate').expect(200);
      expect(response.body.active).toBe(false);
      await action('ML', 'deactivate').expect(200);
    });

    it('refuses while a store is not closed', async () => {
      await create(MALI).expect(201);
      await action('ML', 'activate').expect(200);
      await addStore('ML', 'PENDING');

      const response = await action('ML', 'deactivate').expect(409);

      expect(response.body).toMatchObject({
        error: 'COUNTRY_IN_USE',
        message: 'Ce pays a encore 1 quincaillerie(s) non fermée(s)',
      });
    });

    it('allows it once every store is closed', async () => {
      await create(MALI).expect(201);
      await action('ML', 'activate').expect(200);
      await addStore('ML', 'CLOSED');

      await action('ML', 'deactivate').expect(200);
    });

    it('answers 404 for an unknown code', async () => {
      await action('ZZ', 'deactivate').expect(404);
    });
  });
});
