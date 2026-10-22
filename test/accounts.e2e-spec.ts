import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { createTestApp } from './utils/app.js';
import { createMali, createStoreRecord } from './utils/countries.js';
import { resetDatabase } from './utils/reset-database.js';
import { signedInStaff, type MobileStaff } from './utils/staff.js';
import { createUser } from './utils/users.js';

type Status = 'PENDING' | 'VERIFIED' | 'SUSPENDED' | 'CLOSED';

const NUMBER_FORMAT = /^C-\d{6,}$/;

describe('Customer accounts (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let storeId: string;
  let manager: MobileStaff;
  let seller: MobileStaff;

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
  });

  beforeEach(async () => {
    await resetDatabase(prisma);
    await createMali(prisma);
    storeId = (await createStoreRecord(prisma, { status: 'VERIFIED' })).id;
    manager = await signedInStaff(app, prisma, {
      phone: '+22376000000',
      firstName: 'Awa',
      store: { id: storeId, role: 'MANAGER' },
    });
    seller = await signedInStaff(app, prisma, {
      phone: '+22376000001',
      firstName: 'Moussa',
      store: { id: storeId, role: 'SELLER' },
    });
  });

  afterAll(async () => {
    await app.close();
  });

  const api = () => request(app.getHttpServer());
  const openAccount = (
    body: Record<string, unknown> = {},
    as = seller,
    store = storeId,
  ) =>
    api()
      .post(`/api/v1/stores/${store}/accounts`)
      .set('Authorization', as.authorization)
      .send({
        customer: {
          phone: '76 44 55 66',
          firstName: 'Fanta',
          lastName: 'Keita',
        },
        beneficiary: { name: 'Ali Keita', phone: '76 77 88 99' },
        termsAccepted: true,
        ...body,
      });
  const logs = () =>
    prisma.activityLog.findMany({ orderBy: { createdAt: 'asc' } });
  const setStoreStatus = (status: Status) =>
    prisma.hardwareStore.update({ where: { id: storeId }, data: { status } });

  describe('POST /stores/:storeId/accounts', () => {
    it.each([
      ['a seller', () => seller, 'Moussa'],
      ['a manager', () => manager, 'Awa'],
    ])(
      'lets %s open an account: number, currency, balance 0, Unassigned goal, logged',
      async (_, who, openerName) => {
        const opener = who();
        const before = Date.now();

        const response = await openAccount({}, opener).expect(201);

        const customer = await prisma.user.findUniqueOrThrow({
          where: { phone: '+22376445566' },
        });
        expect(response.body).toEqual({
          id: expect.any(String),
          number: expect.stringMatching(NUMBER_FORMAT),
          status: 'ACTIVE',
          balance: '0',
          currencyCode: 'XOF',
          customer: {
            userId: customer.id,
            firstName: 'Fanta',
            lastName: 'Keita',
            phone: '+22376445566',
          },
          beneficiary: { name: 'Ali Keita', phone: '+22376778899' },
          termsAcceptedAt: expect.any(String),
          goals: [
            {
              id: expect.any(String),
              label: 'Non affecté',
              isSystem: true,
              targetAmount: null,
              status: 'IN_PROGRESS',
              balance: '0',
              projectId: null,
              reachedAt: null,
            },
          ],
          projects: [],
          openedBy: {
            userId: opener.userId,
            firstName: openerName,
            lastName: 'Diallo',
          },
          createdAt: expect.any(String),
          hasIdPhoto: false,
        });
        const body = response.body as {
          id: string;
          number: string;
          termsAcceptedAt: string;
        };
        expect(new Date(body.termsAcceptedAt).getTime()).toBeGreaterThanOrEqual(
          before - 1000,
        );
        expect(await logs()).toMatchObject([
          {
            storeId,
            userId: opener.userId,
            action: 'ACCOUNT_OPENED',
            oldValue: null,
            newValue: {
              accountId: body.id,
              number: body.number,
              customerId: customer.id,
            },
            device: opener.deviceId,
          },
        ]);
      },
    );

    it('creates the customer of a new phone without a PIN', async () => {
      await openAccount().expect(201);

      const customer = await prisma.user.findUniqueOrThrow({
        where: { phone: '+22376445566' },
      });
      expect(customer).toMatchObject({
        firstName: 'Fanta',
        lastName: 'Keita',
        pinHash: null,
      });
    });

    it('reuses an existing user, keeps their names, and shows them', async () => {
      const existing = await createUser(prisma, {
        phone: '+22376445566',
        firstName: 'Aminata',
      });

      const response = await openAccount({
        customer: {
          phone: '+223 76 44 55 66',
          firstName: 'Autre',
          lastName: 'Nom',
        },
      }).expect(201);

      expect(response.body.customer).toEqual({
        userId: existing.id,
        firstName: 'Aminata',
        lastName: 'Diallo',
        phone: '+22376445566',
      });
      expect(
        await prisma.user.findUniqueOrThrow({ where: { id: existing.id } }),
      ).toMatchObject({ firstName: 'Aminata', lastName: 'Diallo' });
    });

    it('opens an account for a colleague of the store (only one’s own is refused)', async () => {
      const response = await openAccount(
        {
          customer: {
            phone: manager.phone,
            firstName: 'Awa',
            lastName: 'Diallo',
          },
        },
        seller,
      ).expect(201);

      expect(response.body.customer.userId).toBe(manager.userId);
    });

    it('accepts no beneficiary, or a beneficiary without a phone', async () => {
      const without = await openAccount({ beneficiary: undefined }).expect(201);
      const nameOnly = await openAccount({
        customer: { phone: '76 11 22 33', firstName: 'Ali', lastName: 'Cissé' },
        beneficiary: { name: 'Mariam Cissé' },
      }).expect(201);

      expect(without.body.beneficiary).toBeNull();
      expect(nameOnly.body.beneficiary).toEqual({
        name: 'Mariam Cissé',
        phone: null,
      });
    });

    it('treats a null beneficiary phone as no phone (F-21)', async () => {
      const response = await openAccount({
        beneficiary: { name: 'Ali Keita', phone: null },
      }).expect(201);

      expect(response.body.beneficiary).toEqual({
        name: 'Ali Keita',
        phone: null,
      });
      expect(
        await prisma.account.findUniqueOrThrow({
          where: { id: response.body.id },
          select: { beneficiaryName: true, beneficiaryPhone: true },
        }),
      ).toEqual({ beneficiaryName: 'Ali Keita', beneficiaryPhone: null });
    });

    it('opens without a beneficiary when it is null', async () => {
      const response = await openAccount({ beneficiary: null }).expect(201);

      expect(response.body.beneficiary).toBeNull();
    });

    it('still refuses a null customer phone with a French 400', async () => {
      const response = await openAccount({
        customer: { phone: null, firstName: 'Fanta', lastName: 'Keita' },
      }).expect(400);

      expect(response.body.details).toContainEqual({
        field: 'customer.phone',
        errors: expect.arrayContaining(['Le numéro de téléphone est requis']),
      });
      expect(await prisma.account.count()).toBe(0);
    });

    it('gives each account its own increasing number', async () => {
      const first = await openAccount().expect(201);
      const second = await openAccount({
        customer: { phone: '76 11 22 33', firstName: 'Ali', lastName: 'Cissé' },
      }).expect(201);

      const value = (number: string) => Number(number.slice(2));
      expect(value(second.body.number)).toBeGreaterThan(
        value(first.body.number),
      );
    });

    it.each([
      ['missing', undefined],
      ['false', false],
      ['the text "true"', 'true'],
    ])(
      'refuses termsAccepted %s with a French 400 and opens nothing',
      async (_, termsAccepted) => {
        const response = await openAccount({ termsAccepted }).expect(400);

        expect(response.body.details).toEqual([
          {
            field: 'termsAccepted',
            errors: [
              'Le client doit accepter les conditions de la quincaillerie',
            ],
          },
        ]);
        expect(await prisma.account.count()).toBe(0);
      },
    );

    it('refuses a beneficiary phone without a name', async () => {
      const response = await openAccount({
        beneficiary: { phone: '76 77 88 99' },
      }).expect(400);

      expect(response.body.details).toEqual([
        {
          field: 'beneficiary.name',
          errors: expect.arrayContaining(['Le nom du bénéficiaire est requis']),
        },
      ]);
    });

    it.each([
      ['no customer', { customer: undefined }, 'customer'],
      ['a customer that is not an object', { customer: ['x'] }, 'customer'],
      [
        'a customer without names',
        { customer: { phone: '76 44 55 66' } },
        'customer.firstName',
      ],
      [
        'a beneficiary that is not an object',
        { beneficiary: 'Ali' },
        'beneficiary',
      ],
    ])('refuses %s with a 400', async (_, body, field) => {
      const response = await openAccount(body).expect(400);

      expect(response.body.details).toContainEqual(
        expect.objectContaining({ field }),
      );
    });

    it('refuses phones of another country, listing both fields', async () => {
      const response = await openAccount({
        customer: {
          phone: '+225 07 00 00 00 00',
          firstName: 'Fanta',
          lastName: 'Keita',
        },
        beneficiary: { name: 'Ali Keita', phone: '+225 07 00 00 00 01' },
      }).expect(400);

      expect(response.body.details).toEqual([
        {
          field: 'customer.phone',
          errors: ['Ce numéro n’est pas un numéro valide du pays ML'],
        },
        {
          field: 'beneficiary.phone',
          errors: ['Ce numéro n’est pas un numéro valide du pays ML'],
        },
      ]);
      expect(await prisma.user.count()).toBe(2);
    });

    it('refuses an invalid beneficiary phone alone', async () => {
      const response = await openAccount({
        beneficiary: { name: 'Ali Keita', phone: '00 00 00 00' },
      }).expect(400);

      expect(response.body.details).toEqual([
        {
          field: 'beneficiary.phone',
          errors: ['Ce numéro n’est pas un numéro valide du pays ML'],
        },
      ]);
      expect(await prisma.account.count()).toBe(0);
    });

    it('refuses an account in one’s own name with 409 OWN_ACCOUNT', async () => {
      const response = await openAccount({
        customer: { phone: '76 00 00 01', firstName: 'Moussa', lastName: 'X' },
      }).expect(409);

      expect(response.body).toMatchObject({
        error: 'OWN_ACCOUNT',
        message:
          'Vous ne pouvez pas ouvrir un compte à votre propre nom : demandez à un collègue ou au gérant',
      });
      expect(await prisma.account.count()).toBe(0);
      expect(await logs()).toEqual([]);
    });

    it('refuses a second account for the same customer in the same store', async () => {
      await openAccount().expect(201);

      const response = await openAccount({}, manager).expect(409);

      expect(response.body).toMatchObject({
        error: 'ACCOUNT_EXISTS',
        message: 'Ce client a déjà un compte dans cette quincaillerie',
      });
      expect(await prisma.account.count()).toBe(1);
      expect(await prisma.goal.count()).toBe(1);
      expect(await logs()).toHaveLength(1);
    });

    it('lets only one of two parallel openings for the same customer through', async () => {
      const statuses = (
        await Promise.all([openAccount(), openAccount({}, manager)])
      )
        .map((r) => r.status)
        .sort((a, b) => a - b);

      expect(statuses).toEqual([201, 409]);
      expect(
        await prisma.user.count({ where: { phone: '+22376445566' } }),
      ).toBe(1);
      expect(await prisma.account.count()).toBe(1);
      expect(await prisma.goal.count()).toBe(1);
      expect(await logs()).toHaveLength(1);
    });

    it('allows the same customer an account in another store', async () => {
      const otherStoreId = (
        await createStoreRecord(prisma, {
          name: 'Quincaillerie du Fleuve',
          status: 'VERIFIED',
        })
      ).id;
      const otherSeller = await signedInStaff(app, prisma, {
        phone: '+22376000002',
        store: { id: otherStoreId, role: 'SELLER' },
      });

      const here = await openAccount().expect(201);
      const there = await openAccount({}, otherSeller, otherStoreId).expect(
        201,
      );

      expect(there.body.customer.userId).toBe(here.body.customer.userId);
      expect(there.body.number).not.toBe(here.body.number);
      expect(await prisma.account.count()).toBe(2);
    });

    it.each([
      ['PENDING', 'en attente de vérification'],
      ['SUSPENDED', 'suspendue'],
      ['CLOSED', 'fermée'],
    ] as const)(
      'refuses a %s store with 409 STORE_NOT_VERIFIED and opens nothing',
      async (status, label) => {
        await setStoreStatus(status);

        const response = await openAccount().expect(409);

        expect(response.body).toMatchObject({
          error: 'STORE_NOT_VERIFIED',
          message: `Cette quincaillerie est ${label} : aucun compte ne peut y être ouvert avant sa vérification`,
        });
        expect(await prisma.user.count()).toBe(2);
        expect(await prisma.account.count()).toBe(0);
        expect(await logs()).toEqual([]);
      },
    );

    it('answers 404 to a member of another store', async () => {
      const otherStoreId = (
        await createStoreRecord(prisma, { status: 'VERIFIED' })
      ).id;
      const outsider = await signedInStaff(app, prisma, {
        phone: '+22376000002',
        store: { id: otherStoreId, role: 'MANAGER' },
      });

      await openAccount({}, outsider).expect(404);
      expect(await prisma.account.count()).toBe(0);
    });

    it('answers 404 to a deactivated seller', async () => {
      await prisma.storeMember.updateMany({
        where: { userId: seller.userId },
        data: { active: false },
      });

      await openAccount().expect(404);
    });

    it('answers 400 to a malformed store id and 401 without a session', async () => {
      await openAccount({}, seller, 'not-a-uuid').expect(400);
      await api()
        .post(`/api/v1/stores/${storeId}/accounts`)
        .send({})
        .expect(401);
    });
  });

  describe('staff reading', () => {
    type Summary = { id: string; number: string; customer: { phone: string } };
    let fanta: { id: string; number: string };
    let ali: { id: string; number: string };
    let elsewhere: { id: string };

    const open = async (phone: string, firstName: string, lastName: string) =>
      (
        await openAccount({ customer: { phone, firstName, lastName } }).expect(
          201,
        )
      ).body as { id: string; number: string };
    const search = (query: Record<string, string | number>, as = seller) =>
      api()
        .get(`/api/v1/stores/${storeId}/accounts`)
        .query(query)
        .set('Authorization', as.authorization);
    const detail = (accountId: string, as = seller) =>
      api()
        .get(`/api/v1/stores/${storeId}/accounts/${accountId}`)
        .set('Authorization', as.authorization);
    const found = async (q: string) =>
      ((await search({ q }).expect(200)).body.items as Summary[]).map(
        (item) => item.number,
      );

    beforeEach(async () => {
      fanta = await open('76 44 55 66', 'Fanta', 'Keita');
      ali = await open('76 11 22 33', 'Ali', 'Cissé');
      await open('76 77 88 00', 'Mariam', 'Traoré');

      // A Keita with an account in another store only.
      const otherStoreId = (
        await createStoreRecord(prisma, { status: 'VERIFIED' })
      ).id;
      const otherSeller = await signedInStaff(app, prisma, {
        phone: '+22376000002',
        store: { id: otherStoreId, role: 'SELLER' },
      });
      elsewhere = (
        await openAccount(
          {
            customer: {
              phone: '76 99 88 77',
              firstName: 'Bakary',
              lastName: 'Keita',
            },
          },
          otherSeller,
          otherStoreId,
        ).expect(201)
      ).body as { id: string };
    });

    describe('GET /stores/:storeId/accounts', () => {
      it('lists this store’s accounts only, newest first, as summaries', async () => {
        const response = await search({}).expect(200);

        expect(response.body).toMatchObject({
          total: 3,
          page: 1,
          pageSize: 20,
        });
        const items = response.body.items as Summary[];
        expect(items.map((item) => item.customer.phone)).toEqual([
          '+22376778800',
          '+22376112233',
          '+22376445566',
        ]);
        expect(items[2]).toEqual({
          id: fanta.id,
          number: fanta.number,
          status: 'ACTIVE',
          balance: '0',
          currencyCode: 'XOF',
          customer: {
            userId: expect.any(String),
            firstName: 'Fanta',
            lastName: 'Keita',
            phone: '+22376445566',
          },
          createdAt: expect.any(String),
          hasIdPhoto: false,
        });
      });

      it('lets a manager search too', async () => {
        await search({}, manager)
          .expect(200)
          .expect((r) => expect(r.body.total).toBe(3));
      });

      it('finds an account by its number, in any case', async () => {
        expect(await found(ali.number)).toEqual([ali.number]);
        expect(await found(ali.number.toLowerCase())).toEqual([ali.number]);
      });

      it.each([
        ['local', '76 11 22 33'],
        ['international', '+223 76 11 22 33'],
        ['E.164', '+22376112233'],
        ['partial', '761122'],
      ])('finds an account by the customer’s %s phone', async (_, q) => {
        expect(await found(q)).toEqual([ali.number]);
      });

      it('finds accounts by first or last name, ignoring case', async () => {
        expect(await found('fanta')).toEqual([fanta.number]);
        expect(await found('KEITA')).toEqual([fanta.number]);
        expect(await found('ciss')).toEqual([ali.number]);
      });

      it('never lists another store’s account, even when it matches', async () => {
        expect(await found('Bakary')).toEqual([]);
        expect(await found('76 99 88 77')).toEqual([]);
      });

      it('matches % and _ literally, not as wildcards', async () => {
        expect(await found('%')).toEqual([]);
        expect(await found('_')).toEqual([]);
      });

      it('pages the results with the real total', async () => {
        const response = await search({ page: 2, pageSize: 2 }).expect(200);

        expect(response.body).toMatchObject({ total: 3, page: 2, pageSize: 2 });
        expect(
          (response.body.items as Summary[]).map((item) => item.number),
        ).toEqual([fanta.number]);
      });

      it.each([
        ['page 0', { page: 0 }, 'page'],
        ['a page size above 100', { pageSize: 101 }, 'pageSize'],
        ['a search over 100 characters', { q: 'x'.repeat(101) }, 'q'],
      ])('refuses %s with a French 400', async (_, query, field) => {
        const response = await search(query).expect(400);

        expect(response.body.details).toContainEqual(
          expect.objectContaining({ field }),
        );
      });
    });

    describe('GET /stores/:storeId/accounts/:accountId', () => {
      it('gives the account detail with its goals', async () => {
        const response = await detail(fanta.id).expect(200);

        expect(response.body).toMatchObject({
          id: fanta.id,
          number: fanta.number,
          balance: '0',
          customer: { firstName: 'Fanta', lastName: 'Keita' },
          beneficiary: { name: 'Ali Keita', phone: '+22376778899' },
          goals: [{ label: 'Non affecté', isSystem: true }],
          openedBy: { userId: seller.userId },
        });
      });

      it('lets a manager read it too', async () => {
        await detail(fanta.id, manager).expect(200);
      });

      it.each([
        ['an account of another store', () => elsewhere.id],
        ['an unknown id', () => '0192f0a4-7b1c-7c3e-9d2a-5e6f7a8b9c0d'],
      ])('answers 404 to %s', async (_, id) => {
        const response = await detail(id()).expect(404);

        expect(response.body.message).toBe('Compte introuvable');
      });

      it('answers 400 to a malformed account id', async () => {
        const response = await detail('not-a-uuid').expect(400);

        expect(response.body.message).toBe('Identifiant de compte invalide');
      });
    });
  });
});
