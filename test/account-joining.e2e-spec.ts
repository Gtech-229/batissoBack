import type { INestApplication } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { newQrCode } from '../src/qr-codes/qr-code.js';
import { createTestApp } from './utils/app.js';
import { createMali, createStoreRecord } from './utils/countries.js';
import { resetDatabase } from './utils/reset-database.js';
import { signedInStaff, type MobileStaff } from './utils/staff.js';

type Status = 'PENDING' | 'VERIFIED' | 'SUSPENDED' | 'CLOSED';

describe('Joining a store from the app (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let customer: MobileStaff;
  let storeId: string;
  let code: string;

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
  });

  beforeEach(async () => {
    await resetDatabase(prisma);
    await createMali(prisma);
    code = newQrCode();
    storeId = (
      await createStoreRecord(prisma, {
        name: 'Quincaillerie du Carrefour',
        status: 'VERIFIED',
      })
    ).id;
    await prisma.hardwareStore.update({
      where: { id: storeId },
      data: { qrCode: code },
    });
    await prisma.storeSettings.update({
      where: { storeId },
      data: { terms: 'Dépôts non remboursables.' },
    });
    customer = await signedInStaff(app, prisma, {
      phone: '+22376123401',
      firstName: 'Fanta',
    });
  });

  afterAll(async () => {
    await app.close();
  });

  const api = () => request(app.getHttpServer());
  const preview = (
    body: unknown = { code },
    as: MobileStaff | null = customer,
  ) => {
    const call = api().post('/api/v1/me/accounts/join/preview');
    if (as) {
      call.set('Authorization', as.authorization);
    }
    return call.send(body as object);
  };
  const setStatus = (status: Status) =>
    prisma.hardwareStore.update({ where: { id: storeId }, data: { status } });

  describe('POST /me/accounts/join/preview', () => {
    it('shows the store, its terms and its money rules', async () => {
      const response = await preview().expect(200);

      expect(response.body).toEqual({
        id: storeId,
        name: 'Quincaillerie du Carrefour',
        city: 'Bamako',
        terms: 'Dépôts non remboursables.',
        currencyCode: 'XOF',
        currencySymbol: 'F CFA',
        decimals: 0,
        minDeposit: '500',
        maxBalance: '2000000',
        deliveryDelayDays: 30,
      });
    });

    it('writes nothing', async () => {
      await preview().expect(200);

      expect(await prisma.account.count()).toBe(0);
      expect(await prisma.activityLog.count()).toBe(0);
    });

    it('answers 404 to an unknown code, and to a replaced one', async () => {
      const unknown = await preview({ code: newQrCode() }).expect(404);
      expect(unknown.body).toMatchObject({
        message: 'Quincaillerie introuvable',
      });

      await prisma.hardwareStore.update({
        where: { id: storeId },
        data: { qrCode: newQrCode() },
      });
      await preview().expect(404);
    });

    it.each([
      ['PENDING', 'en attente de vérification'],
      ['SUSPENDED', 'suspendue'],
      ['CLOSED', 'fermée'],
    ] as const)(
      'refuses a %s store with 409 STORE_NOT_VERIFIED',
      async (status, label) => {
        await setStatus(status);

        const response = await preview().expect(409);

        expect(response.body).toMatchObject({
          error: 'STORE_NOT_VERIFIED',
          message: `Cette quincaillerie est ${label} : aucun compte ne peut y être ouvert avant sa vérification`,
        });
      },
    );

    it.each([
      ['a missing code', {}],
      ['a short code', { code: 'abc' }],
      ['a code with other characters', { code: `${'a'.repeat(31)}!` }],
    ])('refuses %s with a French 400', async (_, body) => {
      const response = await preview(body).expect(400);

      expect(response.body.details).toEqual([
        { field: 'code', errors: ['Code QR invalide'] },
      ]);
    });

    it('refuses a request without a session (401)', async () => {
      await preview({ code }, null).expect(401);
    });
  });

  const join = (
    body: Record<string, unknown> = { code, termsAccepted: true },
    as: MobileStaff | null = customer,
  ) => {
    const call = api().post('/api/v1/me/accounts/join');
    if (as) {
      call.set('Authorization', as.authorization);
    }
    return call.send(body);
  };

  describe('POST /me/accounts/join', () => {
    it('opens the account at once, the customer as its opener', async () => {
      const response = await join({
        code,
        termsAccepted: true,
        beneficiary: { name: 'Aminata Keita', phone: '76 55 44 33' },
      }).expect(201);

      expect(response.body).toMatchObject({
        id: expect.any(String),
        number: expect.any(String),
        currencyCode: 'XOF',
        balance: '0',
        status: 'ACTIVE',
        store: { id: storeId, name: 'Quincaillerie du Carrefour' },
      });
      const account = await prisma.account.findUniqueOrThrow({
        where: { id: response.body.id as string },
        include: { goals: true },
      });
      expect(account).toMatchObject({
        customerId: customer.userId,
        storeId,
        openedById: customer.userId,
        idPhotoPath: null,
        beneficiaryName: 'Aminata Keita',
        beneficiaryPhone: '+22376554433',
      });
      expect(account.termsAcceptedAt).toBeInstanceOf(Date);
      expect(account.goals).toEqual([
        expect.objectContaining({ label: 'Non affecté', isSystem: true }),
      ]);
      const logs = await prisma.activityLog.findMany();
      expect(logs).toEqual([
        expect.objectContaining({
          storeId,
          userId: customer.userId,
          action: 'ACCOUNT_OPENED',
          newValue: {
            accountId: account.id,
            number: account.number,
            customerId: customer.userId,
          },
        }),
      ]);
      // The code is never written to the activity row.
      expect(JSON.stringify(logs)).not.toContain(code);
    });

    it('lists the account in GET /me/accounts and shows it to the store, which can take a deposit', async () => {
      const accountId = (await join().expect(201)).body.id as string;
      const seller = await signedInStaff(app, prisma, {
        phone: '+22376451278',
        store: { id: storeId, role: 'SELLER' },
      });

      const mine = await api()
        .get('/api/v1/me/accounts')
        .set('Authorization', customer.authorization)
        .expect(200);
      expect(mine.body.map((a: { id: string }) => a.id)).toEqual([accountId]);

      const detail = await api()
        .get(`/api/v1/stores/${storeId}/accounts/${accountId}`)
        .set('Authorization', seller.authorization)
        .expect(200);
      expect(detail.body).toMatchObject({ hasIdPhoto: false });

      await api()
        .post(`/api/v1/stores/${storeId}/accounts/${accountId}/deposits`)
        .set('Authorization', seller.authorization)
        .set('Idempotency-Key', randomUUID())
        .send({ amount: '5000' })
        .expect(201);
    });

    it('accepts a beneficiary with a null phone', async () => {
      const response = await join({
        code,
        termsAccepted: true,
        beneficiary: { name: 'Aminata Keita', phone: null },
      }).expect(201);

      const account = await prisma.account.findUniqueOrThrow({
        where: { id: response.body.id as string },
      });
      expect(account).toMatchObject({
        beneficiaryName: 'Aminata Keita',
        beneficiaryPhone: null,
      });
    });

    it('lets a seller of the store join it as a customer', async () => {
      const seller = await signedInStaff(app, prisma, {
        phone: '+22376451278',
        store: { id: storeId, role: 'SELLER' },
      });

      await join({ code, termsAccepted: true }, seller).expect(201);
    });

    it('refuses a second account in the same store with 409 ACCOUNT_EXISTS', async () => {
      await join().expect(201);

      const response = await join().expect(409);

      expect(response.body).toMatchObject({ error: 'ACCOUNT_EXISTS' });
      expect(await prisma.account.count()).toBe(1);
    });

    it('lets only one of two parallel joins through', async () => {
      const responses = await Promise.all([join(), join()]);

      expect(responses.map((r) => r.status).sort((a, b) => a - b)).toEqual([
        201, 409,
      ]);
      expect(await prisma.account.count()).toBe(1);
      expect(await prisma.goal.count()).toBe(1);
      expect(await prisma.activityLog.count()).toBe(1);
    });

    it.each([
      ['terms not sent', { code }, 'termsAccepted'],
      ['terms refused', { code, termsAccepted: false }, 'termsAccepted'],
      ['a missing code', { termsAccepted: true }, 'code'],
      [
        'a beneficiary without a name',
        { code, termsAccepted: true, beneficiary: { phone: '76 55 44 33' } },
        'beneficiary.name',
      ],
    ])('refuses %s with a French 400', async (_, body, field) => {
      const response = await join(body).expect(400);

      expect(response.body.details).toEqual(
        expect.arrayContaining([expect.objectContaining({ field })]),
      );
      expect(await prisma.account.count()).toBe(0);
    });

    it('refuses a beneficiary phone of another country', async () => {
      const response = await join({
        code,
        termsAccepted: true,
        beneficiary: { name: 'Aminata Keita', phone: '+221 77 123 45 67' },
      }).expect(400);

      expect(response.body.details).toEqual([
        {
          field: 'beneficiary.phone',
          errors: ['Ce numéro n’est pas un numéro valide du pays ML'],
        },
      ]);
      expect(await prisma.account.count()).toBe(0);
    });

    it('refuses with 409 PHONE_NOT_OF_STORE_COUNTRY a store of another country', async () => {
      await prisma.country.create({
        data: {
          code: 'CI',
          name: 'Côte d’Ivoire',
          phonePrefix: '+225',
          currencyCode: 'XOF',
          currencySymbol: 'F CFA',
          decimals: 0,
          active: false,
        },
      });
      const ivorian = await createStoreRecord(prisma, {
        status: 'VERIFIED',
        countryCode: 'CI',
      });
      const ivorianCode = newQrCode();
      await prisma.hardwareStore.update({
        where: { id: ivorian.id },
        data: { qrCode: ivorianCode },
      });

      const response = await join({
        code: ivorianCode,
        termsAccepted: true,
      }).expect(409);

      expect(response.body).toMatchObject({
        error: 'PHONE_NOT_OF_STORE_COUNTRY',
      });
      expect(await prisma.account.count()).toBe(0);
    });

    it.each(['PENDING', 'SUSPENDED', 'CLOSED'] as const)(
      'refuses a %s store with 409 STORE_NOT_VERIFIED',
      async (status) => {
        await setStatus(status);

        const response = await join().expect(409);

        expect(response.body).toMatchObject({ error: 'STORE_NOT_VERIFIED' });
        expect(await prisma.account.count()).toBe(0);
      },
    );

    it('answers 404 to an unknown code', async () => {
      await join({ code: newQrCode(), termsAccepted: true }).expect(404);
      expect(await prisma.account.count()).toBe(0);
    });

    it('refuses a request without a session (401)', async () => {
      await join({ code, termsAccepted: true }, null).expect(401);
    });
  });
});
