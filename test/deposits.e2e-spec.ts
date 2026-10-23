import type { INestApplication } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { createTestApp } from './utils/app.js';
import { createMali, createStoreRecord } from './utils/countries.js';
import { resetDatabase } from './utils/reset-database.js';
import { signedInStaff, type MobileStaff } from './utils/staff.js';

type Status = 'PENDING' | 'VERIFIED' | 'SUSPENDED' | 'CLOSED';

const REFERENCE = /^D-\d{5,}$/;

// createStoreRecord's settings: minimum deposit 500, maximum balance 2 000 000.
describe('Cash deposits (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let storeId: string;
  let manager: MobileStaff;
  let seller: MobileStaff;
  let accountId: string;

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
  });

  beforeEach(async () => {
    await resetDatabase(prisma);
    await createMali(prisma);
    storeId = (
      await createStoreRecord(prisma, {
        name: 'Quincaillerie du Carrefour',
        status: 'VERIFIED',
      })
    ).id;
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
    accountId = await openAccount('76 44 55 66', 'Fanta');
  });

  afterAll(async () => {
    await app.close();
  });

  const api = () => request(app.getHttpServer());
  const openAccount = async (phone: string, firstName: string, as = seller) =>
    (
      await api()
        .post(`/api/v1/stores/${storeId}/accounts`)
        .set('Authorization', as.authorization)
        .send({
          customer: { phone, firstName, lastName: 'Keita' },
          termsAccepted: true,
        })
        .expect(201)
    ).body.id as string;
  const deposit = (
    amount: unknown,
    options: {
      as?: MobileStaff;
      account?: string;
      store?: string;
      key?: string | null;
    } = {},
  ) => {
    const call = api()
      .post(
        `/api/v1/stores/${options.store ?? storeId}/accounts/${options.account ?? accountId}/deposits`,
      )
      .set('Authorization', (options.as ?? seller).authorization);
    if (options.key !== null) {
      call.set('Idempotency-Key', options.key ?? randomUUID());
    }
    return call.send({ amount });
  };
  const balances = async (account = accountId) => {
    const row = await prisma.account.findUniqueOrThrow({
      where: { id: account },
      include: { goals: true },
    });
    return {
      account: row.balance,
      unassigned: row.goals.find((goal) => goal.isSystem)!.balance,
    };
  };
  const operations = () =>
    prisma.operation.findMany({ orderBy: { balanceBefore: 'asc' } });

  describe('POST /stores/:storeId/accounts/:accountId/deposits', () => {
    it.each([
      ['a seller', () => seller, 'Moussa'],
      ['a manager', () => manager, 'Awa'],
    ])(
      'lets %s record a deposit: receipt, balances, operation',
      async (_, who, firstName) => {
        const author = who();
        const key = randomUUID();

        const response = await deposit('5000', { as: author, key }).expect(201);

        const account = await prisma.account.findUniqueOrThrow({
          where: { id: accountId },
          include: { goals: true },
        });
        expect(response.body).toEqual({
          id: expect.any(String),
          reference: expect.stringMatching(REFERENCE),
          type: 'DEPOSIT',
          direction: 'CREDIT',
          status: 'CONFIRMED',
          channel: 'CASH',
          amount: '5000',
          currencyCode: 'XOF',
          balanceBefore: '0',
          balanceAfter: '5000',
          goal: { id: account.goals[0].id, label: 'Non affecté' },
          account: { id: accountId, number: account.number },
          customer: { firstName: 'Fanta', lastName: 'Keita' },
          store: {
            id: storeId,
            name: 'Quincaillerie du Carrefour',
            address: 'Rue 12',
            city: 'Bamako',
            phone: '+22320220000',
          },
          recordedBy: { firstName, lastName: 'Diallo' },
          createdAt: expect.any(String),
        });
        // Never the key or the device in a receipt.
        expect(JSON.stringify(response.body)).not.toContain(key);
        expect(JSON.stringify(response.body)).not.toContain(author.deviceId);
        expect(await balances()).toEqual({ account: 5000n, unassigned: 5000n });
        expect(await operations()).toMatchObject([
          {
            accountId,
            storeId,
            authorId: author.userId,
            device: author.deviceId,
            idempotencyKey: key,
            amount: 5000n,
            balanceBefore: 0n,
            balanceAfter: 5000n,
          },
        ]);
      },
    );

    it('chains deposits: each starts from the previous balance', async () => {
      await deposit('5000').expect(201);
      await deposit('2500', { as: manager }).expect(201);
      const third = await deposit('500').expect(201);

      expect(third.body).toMatchObject({
        balanceBefore: '7500',
        balanceAfter: '8000',
      });
      expect(
        (await operations()).map((op) => [op.balanceBefore, op.balanceAfter]),
      ).toEqual([
        [0n, 5000n],
        [5000n, 7500n],
        [7500n, 8000n],
      ]);
      expect(await balances()).toEqual({ account: 8000n, unassigned: 8000n });
    });

    it('serializes 20 parallel deposits on one account: no lost update', async () => {
      const responses = await Promise.all(
        Array.from({ length: 20 }, () => deposit('1000')),
      );

      expect(responses.map((r) => r.status)).toEqual(Array(20).fill(201));
      expect(await balances()).toEqual({
        account: 20000n,
        unassigned: 20000n,
      });
      const chain = await operations();
      expect(chain).toHaveLength(20);
      chain.forEach((op, index) => {
        expect(op.balanceBefore).toBe(BigInt(index * 1000));
        expect(op.balanceAfter).toBe(op.balanceBefore + 1000n);
      });
      expect(new Set(chain.map((op) => op.reference)).size).toBe(20);
    });

    it('gives each deposit its own increasing reference', async () => {
      const first = await deposit('1000').expect(201);
      const second = await deposit('1000').expect(201);

      const value = (reference: string) => Number(reference.slice(2));
      expect(value(second.body.reference)).toBeGreaterThan(
        value(first.body.reference),
      );
    });

    it('accepts the exact minimum and the exact maximum balance', async () => {
      await deposit('500').expect(201);
      await deposit('1999500').expect(201);

      expect(await balances()).toEqual({
        account: 2000000n,
        unassigned: 2000000n,
      });
    });

    it('refuses an amount under the minimum deposit with 409 BELOW_MIN_DEPOSIT', async () => {
      const response = await deposit('499').expect(409);

      expect(response.body).toMatchObject({
        error: 'BELOW_MIN_DEPOSIT',
        message: 'Le dépôt minimum de cette quincaillerie est de 500 XOF',
      });
      expect(await operations()).toEqual([]);
    });

    it('refuses a deposit over the maximum balance with 409 MAX_BALANCE_EXCEEDED', async () => {
      await deposit('1990000').expect(201);

      const response = await deposit('10001').expect(409);

      expect(response.body).toMatchObject({
        error: 'MAX_BALANCE_EXCEEDED',
        message:
          'Ce dépôt dépasserait le solde maximal du compte (2000000 XOF) : au plus 10000 XOF peuvent encore être déposés',
      });
      expect(await operations()).toHaveLength(1);
      expect(await balances()).toEqual({
        account: 1990000n,
        unassigned: 1990000n,
      });
    });

    it('applies limits changed by an admin to the next deposit', async () => {
      await prisma.storeSettings.update({
        where: { storeId },
        data: { minDeposit: 2000n },
      });

      await deposit('1500').expect(409);
      await deposit('2000').expect(201);
    });

    it.each([
      ['zero', '0'],
      ['negative', '-500'],
      ['decimal', '500.5'],
      ['a number instead of text', 5000],
      ['with spaces', '5 000'],
      ['missing', undefined],
    ])('refuses an amount that is %s with a French 400', async (_, amount) => {
      const response = await deposit(amount).expect(400);

      expect(response.body.details).toContainEqual(
        expect.objectContaining({ field: 'amount' }),
      );
      expect(await operations()).toEqual([]);
    });

    it('refuses a deposit on one’s own account with 409 OWN_ACCOUNT', async () => {
      // A colleague opens the seller's account: allowed (5a).
      const ownAccount = await openAccount(seller.phone, 'Moussa', manager);

      const response = await deposit('5000', { account: ownAccount }).expect(
        409,
      );

      expect(response.body).toMatchObject({
        error: 'OWN_ACCOUNT',
        message:
          'Vous ne pouvez pas enregistrer un dépôt sur votre propre compte : demandez à un collègue ou au gérant',
      });
      // The manager can record it.
      await deposit('5000', { as: manager, account: ownAccount }).expect(201);
      expect(await operations()).toHaveLength(1);
    });

    it.each([
      ['PENDING', 'en attente de vérification'],
      ['SUSPENDED', 'suspendue'],
      ['CLOSED', 'fermée'],
    ] as const)(
      'refuses a %s store with 409 STORE_NOT_VERIFIED and writes nothing',
      async (status: Status, label) => {
        await prisma.hardwareStore.update({
          where: { id: storeId },
          data: { status },
        });

        const response = await deposit('5000').expect(409);

        expect(response.body).toMatchObject({
          error: 'STORE_NOT_VERIFIED',
          message: `Cette quincaillerie est ${label} : elle ne peut recevoir aucun dépôt`,
        });
        expect(await operations()).toEqual([]);
        expect(await balances()).toEqual({ account: 0n, unassigned: 0n });
      },
    );

    it('answers 404 for another store’s account', async () => {
      const otherStoreId = (
        await createStoreRecord(prisma, { status: 'VERIFIED' })
      ).id;
      const otherSeller = await signedInStaff(app, prisma, {
        phone: '+22376000002',
        store: { id: otherStoreId, role: 'SELLER' },
      });

      const response = await deposit('5000', {
        as: otherSeller,
        store: otherStoreId,
      }).expect(404);

      expect(response.body.message).toBe('Compte introuvable');
      expect(await operations()).toEqual([]);
    });

    it('answers 404 to a member of another store', async () => {
      const otherStoreId = (
        await createStoreRecord(prisma, { status: 'VERIFIED' })
      ).id;
      const outsider = await signedInStaff(app, prisma, {
        phone: '+22376000002',
        store: { id: otherStoreId, role: 'MANAGER' },
      });

      await deposit('5000', { as: outsider }).expect(404);
      expect(await operations()).toEqual([]);
    });

    it('answers 400 to malformed ids and 401 without a session', async () => {
      await deposit('5000', { account: 'not-a-uuid' })
        .expect(400)
        .expect((r) =>
          expect(r.body.message).toBe('Identifiant de compte invalide'),
        );
      await deposit('5000', { store: 'not-a-uuid' }).expect(400);
      await api()
        .post(`/api/v1/stores/${storeId}/accounts/${accountId}/deposits`)
        .set('Idempotency-Key', randomUUID())
        .send({ amount: '5000' })
        .expect(401);
      expect(await operations()).toEqual([]);
    });
  });

  describe('idempotency', () => {
    const KEY_RULE =
      'L’en-tête Idempotency-Key est requis : un UUID généré par l’application pour cette demande, renvoyé tel quel si elle est répétée';

    it('answers a retry with the original receipt and writes nothing new', async () => {
      const key = randomUUID();
      const first = await deposit('5000', { key }).expect(201);

      const retry = await deposit('5000', { key }).expect(200);

      expect(retry.body).toEqual(first.body);
      expect(await operations()).toHaveLength(1);
      expect(await balances()).toEqual({ account: 5000n, unassigned: 5000n });
    });

    it('treats the same key in capitals as the same key', async () => {
      const key = randomUUID();
      const first = await deposit('5000', { key }).expect(201);

      const retry = await deposit('5000', { key: key.toUpperCase() }).expect(
        200,
      );

      expect(retry.body.reference).toBe(first.body.reference);
      expect(await operations()).toHaveLength(1);
    });

    it('answers a retry sent with the store and account ids in capitals (F-02)', async () => {
      const key = randomUUID();
      const capitals = {
        key,
        store: storeId.toUpperCase(),
        account: accountId.toUpperCase(),
      };
      const first = await deposit('5000', capitals).expect(201);

      const retry = await deposit('5000', capitals).expect(200);

      expect(retry.body).toEqual(first.body);
      // The lowercase spelling is the same deposit too.
      await deposit('5000', { key }).expect(200);
      expect(await operations()).toHaveLength(1);
    });

    it('still answers a retry after the store was suspended: the money is in', async () => {
      const key = randomUUID();
      const first = await deposit('5000', { key }).expect(201);
      await prisma.hardwareStore.update({
        where: { id: storeId },
        data: { status: 'SUSPENDED' },
      });

      const retry = await deposit('5000', { key }).expect(200);

      expect(retry.body.reference).toBe(first.body.reference);
    });

    it('lets one of two parallel requests with the same key record the deposit', async () => {
      const key = randomUUID();

      const responses = await Promise.all([
        deposit('5000', { key }),
        deposit('5000', { key }),
      ]);

      expect(responses.map((r) => r.status).sort((a, b) => a - b)).toEqual([
        200, 201,
      ]);
      expect(responses[0].body.reference).toBe(responses[1].body.reference);
      expect(await operations()).toHaveLength(1);
      expect(await balances()).toEqual({ account: 5000n, unassigned: 5000n });
    });

    it('refuses the same key sent in parallel for two accounts: one deposit, one 409', async () => {
      const key = randomUUID();
      const other = await openAccount('76 11 22 33', 'Ali');

      const responses = await Promise.all([
        deposit('5000', { key }),
        deposit('5000', { key, account: other }),
      ]);

      expect(responses.map((r) => r.status).sort((a, b) => a - b)).toEqual([
        201, 409,
      ]);
      expect(responses.find((r) => r.status === 409)?.body.error).toBe(
        'IDEMPOTENCY_KEY_REUSED',
      );
      expect(await operations()).toHaveLength(1);
    });

    it.each([
      ['another amount', () => ({ amount: '6000' })],
      ['another account', () => ({ account: 'other' })],
      ['another author', () => ({ as: 'manager' })],
    ])(
      'refuses a key reused for %s with 409 IDEMPOTENCY_KEY_REUSED',
      async (_, change) => {
        const key = randomUUID();
        await deposit('5000', { key }).expect(201);
        const { amount, account, as } = change() as {
          amount?: string;
          account?: string;
          as?: string;
        };

        const response = await deposit(amount ?? '5000', {
          key,
          account:
            account === 'other'
              ? await openAccount('76 11 22 33', 'Ali')
              : undefined,
          as: as === 'manager' ? manager : undefined,
        }).expect(409);

        expect(response.body).toMatchObject({
          error: 'IDEMPOTENCY_KEY_REUSED',
          message:
            'Cette clé d’idempotence a déjà servi pour une autre opération : générez une nouvelle clé pour un nouveau dépôt',
        });
        expect(await operations()).toHaveLength(1);
        expect(await balances()).toEqual({
          account: 5000n,
          unassigned: 5000n,
        });
      },
    );

    it('records a retry normally when the first attempt was refused', async () => {
      const key = randomUUID();
      await deposit('100', { key }).expect(409);

      await deposit('5000', { key }).expect(201);
      expect(await operations()).toHaveLength(1);
    });

    it.each([
      ['missing', null],
      ['not a UUID', 'retry-1'],
      ['empty', ''],
    ])(
      'refuses a key that is %s with a French 400 and writes nothing',
      async (_, key) => {
        const response = await deposit('5000', { key }).expect(400);

        expect(response.body.details).toEqual([
          { field: 'Idempotency-Key', errors: [KEY_RULE] },
        ]);
        expect(await operations()).toEqual([]);
      },
    );
  });
});
