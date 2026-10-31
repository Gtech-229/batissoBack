import type { INestApplication } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { createTestApp } from './utils/app.js';
import { createMali, createStoreRecord } from './utils/countries.js';
import { resetDatabase } from './utils/reset-database.js';
import { signedInStaff, type MobileStaff } from './utils/staff.js';
import { TEST_PIN } from './utils/users.js';

describe('Daily cash closing (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let storeId: string;
  let otherStoreId: string;
  let manager: MobileStaff;
  let seller: MobileStaff;
  let outsider: MobileStaff;
  let customer: MobileStaff;
  let accountId: string;

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
  });

  beforeEach(async () => {
    await resetDatabase(prisma);
    await createMali(prisma);
    storeId = (await createStoreRecord(prisma, { status: 'VERIFIED' })).id;
    otherStoreId = (await createStoreRecord(prisma, { status: 'VERIFIED' })).id;
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
    outsider = await signedInStaff(app, prisma, {
      phone: '+22376000002',
      store: { id: otherStoreId, role: 'MANAGER' },
    });
    customer = await signedInStaff(app, prisma, {
      phone: '+22376445566',
      firstName: 'Fanta',
    });
    accountId = await openAccount(customer.phone);
  });

  afterAll(async () => {
    await app.close();
  });

  const api = () => request(app.getHttpServer());
  const openAccount = async (phone: string, store = storeId, as = seller) =>
    (
      await api()
        .post(`/api/v1/stores/${store}/accounts`)
        .set('Authorization', as.authorization)
        .send({
          customer: { phone, firstName: 'F', lastName: 'K' },
          termsAccepted: true,
        })
        .expect(201)
    ).body.id as string;
  const postDeposit = (amount: string) =>
    api()
      .post(`/api/v1/stores/${storeId}/accounts/${accountId}/deposits`)
      .set('Authorization', seller.authorization)
      .set('Idempotency-Key', randomUUID())
      .send({ amount });
  const deposit = async (amount: string) =>
    (await postDeposit(amount).expect(201)).body as { id: string };
  const correct = (operationId: string, amount: string) =>
    api()
      .post(
        `/api/v1/stores/${storeId}/accounts/${accountId}/operations/${operationId}/corrections`,
      )
      .set('Authorization', manager.authorization)
      .set('Idempotency-Key', randomUUID())
      .send({ amount, reason: 'Erreur de saisie' })
      .expect(201);
  /** A purchase confirmed by PIN, then cancelled with a re-credit. */
  const purchaseAndRecredit = async () => {
    const categoryId = (
      await prisma.articleCategory.create({ data: { storeId, name: 'Ciment' } })
    ).id;
    const articleId = (
      await prisma.article.create({
        data: {
          storeId,
          categoryId,
          name: 'Ciment CPA 45',
          unit: 'sac de 50 kg',
          currentPrice: 5000n,
        },
      })
    ).id;
    const order = await api()
      .post(`/api/v1/stores/${storeId}/accounts/${accountId}/orders`)
      .set('Authorization', seller.authorization)
      .send({ lines: [{ articleId, quantity: 2 }] })
      .expect(201);
    await api()
      .post(`/api/v1/me/accounts/${accountId}/orders/${order.body.id}/confirm`)
      .set('Authorization', customer.authorization)
      .set('Idempotency-Key', randomUUID())
      .send({ pin: TEST_PIN })
      .expect(201);
    await api()
      .post(
        `/api/v1/stores/${storeId}/orders/${order.body.id}/cancel-after-debit`,
      )
      .set('Authorization', manager.authorization)
      .set('Idempotency-Key', randomUUID())
      .send({ reason: 'Rupture de stock' })
      .expect(201);
  };
  const pending = (as = manager, store = storeId) =>
    api()
      .get(`/api/v1/stores/${store}/cash-closings/pending`)
      .set('Authorization', as.authorization);
  const close = (
    body: Record<string, unknown>,
    options: { as?: MobileStaff; key?: string; store?: string } = {},
  ) => {
    const call = api()
      .post(`/api/v1/stores/${options.store ?? storeId}/cash-closings`)
      .set('Authorization', (options.as ?? manager).authorization);
    if (options.key !== '') {
      call.set('Idempotency-Key', options.key ?? randomUUID());
    }
    return call.send(body);
  };
  const counts = async () => ({
    closings: await prisma.cashClosing.count(),
    links: await prisma.cashClosingOperation.count(),
  });

  describe('GET /stores/:storeId/cash-closings/pending', () => {
    it('counts deposits minus corrections, never purchases or re-credits', async () => {
      const first = await deposit('50000');
      await deposit('2500');
      await correct(first.id, '1500');
      await purchaseAndRecredit();

      await pending()
        .expect(200)
        .expect((r) =>
          expect(r.body).toEqual({
            depositsTotal: '52500',
            correctionsTotal: '1500',
            expectedTotal: '51000',
            currencyCode: 'XOF',
            operationCount: 3,
            since: null,
          }),
        );
    });

    it('is empty for a store with nothing to count, and writes nothing', async () => {
      await pending()
        .expect(200)
        .expect((r) =>
          expect(r.body).toMatchObject({
            expectedTotal: '0',
            operationCount: 0,
            since: null,
          }),
        );
      expect(await counts()).toEqual({ closings: 0, links: 0 });
    });
  });

  describe('POST /stores/:storeId/cash-closings', () => {
    it('closes an exact count without a justification, and pending drops to zero', async () => {
      await deposit('50000');
      await deposit('2500');

      const closed = await close({ countedTotal: '52500' }).expect(201);

      expect(closed.body).toMatchObject({
        depositsTotal: '52500',
        correctionsTotal: '0',
        expectedTotal: '52500',
        countedTotal: '52500',
        discrepancy: '0',
        currencyCode: 'XOF',
        justification: null,
        operationCount: 2,
        closedBy: { firstName: 'Awa', lastName: 'Diallo' },
      });
      const json = JSON.stringify(closed.body);
      expect(json).not.toContain(manager.userId);
      expect(json).not.toContain(manager.deviceId);
      expect(json).not.toContain('idempotencyKey');
      await pending()
        .expect(200)
        .expect((r) =>
          expect(r.body).toMatchObject({
            expectedTotal: '0',
            operationCount: 0,
            since: closed.body.createdAt,
          }),
        );
    });

    it('refuses a shortage without a justification, and writes nothing', async () => {
      await deposit('50000');

      await close({ countedTotal: '49500' })
        .expect(409)
        .expect((r) =>
          expect(r.body).toMatchObject({
            error: 'JUSTIFICATION_REQUIRED',
            message:
              'Le montant attendu est de 50000 XOF, soit un écart de -500 XOF : expliquez cet écart',
          }),
        );
      expect(await counts()).toEqual({ closings: 0, links: 0 });
    });

    it('keeps a signed difference with its justification', async () => {
      await deposit('50000');
      const short = await close({
        countedTotal: '49500',
        justification: '  Monnaie rendue en trop ',
      }).expect(201);
      expect(short.body).toMatchObject({
        discrepancy: '-500',
        justification: 'Monnaie rendue en trop',
      });

      await deposit('10000');
      const extra = await close({
        countedTotal: '10200',
        justification: 'Pièces retrouvées',
      }).expect(201);
      expect(extra.body.discrepancy).toBe('200');
    });

    it('counts only what came after the last closing', async () => {
      await deposit('50000');
      await close({ countedTotal: '50000' }).expect(201);
      await deposit('3000');

      await close({ countedTotal: '3000' })
        .expect(201)
        .expect((r) =>
          expect(r.body).toMatchObject({
            expectedTotal: '3000',
            operationCount: 1,
          }),
        );
    });

    it('puts a correction of a closed deposit in the next closing, even below zero', async () => {
      const closedDeposit = await deposit('50000');
      await close({ countedTotal: '50000' }).expect(201);
      await correct(closedDeposit.id, '4500');

      await pending()
        .expect(200)
        .expect((r) => expect(r.body.expectedTotal).toBe('-4500'));
      await close({ countedTotal: '0', justification: 'Dépôt d’hier corrigé' })
        .expect(201)
        .expect((r) =>
          expect(r.body).toMatchObject({
            depositsTotal: '0',
            correctionsTotal: '4500',
            expectedTotal: '-4500',
            discrepancy: '4500',
          }),
        );
    });

    it('allows an empty closing with an empty drawer', async () => {
      await close({ countedTotal: '0' })
        .expect(201)
        .expect((r) =>
          expect(r.body).toMatchObject({
            expectedTotal: '0',
            discrepancy: '0',
            operationCount: 0,
          }),
        );
    });

    it('closes in a suspended store and in a closed one', async () => {
      await deposit('50000');
      for (const [status, counted] of [
        ['SUSPENDED', '50000'],
        ['CLOSED', '0'],
      ] as const) {
        await prisma.hardwareStore.update({
          where: { id: storeId },
          data: { status },
        });

        await close({ countedTotal: counted }).expect(201);
      }
    });

    it('never counts another store’s operations', async () => {
      await deposit('50000');
      const otherAccount = await openAccount(
        '+22376998877',
        otherStoreId,
        outsider,
      );
      await api()
        .post(
          `/api/v1/stores/${otherStoreId}/accounts/${otherAccount}/deposits`,
        )
        .set('Authorization', outsider.authorization)
        .set('Idempotency-Key', randomUUID())
        .send({ amount: '7000' })
        .expect(201);

      await close(
        { countedTotal: '7000' },
        {
          as: outsider,
          store: otherStoreId,
        },
      )
        .expect(201)
        .expect((r) => expect(r.body.operationCount).toBe(1));
      await pending()
        .expect(200)
        .expect((r) => expect(r.body.expectedTotal).toBe('50000'));
    });

    it('moves no money: balances and operations are unchanged', async () => {
      await deposit('50000');
      const before = await prisma.account.findUniqueOrThrow({
        where: { id: accountId },
        include: { goals: true },
      });
      const operations = await prisma.operation.count();

      await close({ countedTotal: '50000' }).expect(201);

      expect(
        await prisma.account.findUniqueOrThrow({
          where: { id: accountId },
          include: { goals: true },
        }),
      ).toEqual(before);
      expect(await prisma.operation.count()).toBe(operations);
    });

    it('is for the manager only: 403 for a seller, 404 for anyone else', async () => {
      await deposit('50000');

      await pending(seller)
        .expect(403)
        .expect((r) => expect(r.body.error).toBe('STORE_ROLE_REQUIRED'));
      await close({ countedTotal: '50000' }, { as: seller }).expect(403);
      for (const as of [outsider, customer]) {
        await pending(as)
          .expect(404)
          .expect((r) =>
            expect(r.body.message).toBe('Quincaillerie introuvable'),
          );
        await close({ countedTotal: '50000' }, { as }).expect(404);
      }
      expect(await counts()).toEqual({ closings: 0, links: 0 });
    });

    it.each([
      ['no count', {}, 'countedTotal'],
      ['a negative count', { countedTotal: '-1' }, 'countedTotal'],
      ['a decimal count', { countedTotal: '10.5' }, 'countedTotal'],
      ['a number', { countedTotal: 5000 }, 'countedTotal'],
      [
        'a blank justification',
        { countedTotal: '0', justification: '   ' },
        'justification',
      ],
      [
        'a justification over 500 characters',
        { countedTotal: '0', justification: 'x'.repeat(501) },
        'justification',
      ],
    ])('refuses %s with a French 400', async (_, body, field) => {
      await close(body)
        .expect(400)
        .expect((r) =>
          expect(r.body.details).toContainEqual(
            expect.objectContaining({ field }),
          ),
        );
      expect(await counts()).toEqual({ closings: 0, links: 0 });
    });

    it('refuses a missing or invalid Idempotency-Key with 400', async () => {
      for (const key of ['', 'not-a-uuid']) {
        await close({ countedTotal: '0' }, { key })
          .expect(400)
          .expect((r) =>
            expect(r.body.details).toContainEqual(
              expect.objectContaining({ field: 'Idempotency-Key' }),
            ),
          );
      }
      expect(await counts()).toEqual({ closings: 0, links: 0 });
    });

    describe('idempotency', () => {
      it('answers a same-key retry with 200 and the same closing, writing once', async () => {
        await deposit('50000');
        const key = randomUUID();

        const first = await close({ countedTotal: '50000' }, { key }).expect(
          201,
        );
        const again = await close({ countedTotal: '50000' }, { key }).expect(
          200,
        );

        expect(again.body).toEqual(first.body);
        expect(await counts()).toEqual({ closings: 1, links: 1 });
      });

      it('refuses another store’s key and shows none of its data', async () => {
        await deposit('50000');
        const key = randomUUID();
        await close({ countedTotal: '50000' }, { key }).expect(201);

        const refused = await close(
          { countedTotal: '50000' },
          { key, as: outsider, store: otherStoreId },
        ).expect(409);

        expect(refused.body.error).toBe('IDEMPOTENCY_KEY_REUSED');
        const body = JSON.stringify(refused.body);
        expect(body).not.toContain('Awa');
        expect(body).not.toContain('50000');
        expect(await counts()).toEqual({ closings: 1, links: 1 });
      });

      it('lets one of two stores win a key used at the same time', async () => {
        const key = randomUUID();

        const responses = await Promise.all([
          close({ countedTotal: '0' }, { key }),
          close(
            { countedTotal: '0' },
            { key, as: outsider, store: otherStoreId },
          ),
        ]);

        expect(responses.map((r) => r.status).sort((a, b) => a - b)).toEqual([
          201, 409,
        ]);
        const refused = responses.find((r) => r.status === 409);
        expect(refused?.body.error).toBe('IDEMPOTENCY_KEY_REUSED');
        expect(await prisma.cashClosing.count()).toBe(1);
      });

      it('refuses a key reused for another count with 409 IDEMPOTENCY_KEY_REUSED', async () => {
        await deposit('50000');
        const key = randomUUID();
        await close({ countedTotal: '50000' }, { key }).expect(201);

        await close({ countedTotal: '1', justification: 'Autre' }, { key })
          .expect(409)
          .expect((r) => expect(r.body.error).toBe('IDEMPOTENCY_KEY_REUSED'));
        expect(await counts()).toEqual({ closings: 1, links: 1 });
      });

      it('closes once when the same key is sent in parallel', async () => {
        await deposit('50000');
        const key = randomUUID();

        const statuses = (
          await Promise.all(
            [1, 2, 3].map(() => close({ countedTotal: '50000' }, { key })),
          )
        )
          .map((r) => r.status)
          .sort((a, b) => a - b);

        expect(statuses).toEqual([200, 200, 201]);
        expect(await counts()).toEqual({ closings: 1, links: 1 });
      });
    });

    describe('concurrency', () => {
      it('counts every deposit exactly once when deposits race a closing', async () => {
        await deposit('1000');

        const responses = await Promise.all([
          postDeposit('1000'),
          postDeposit('1000'),
          close({ countedTotal: '1000', justification: 'Pendant les dépôts' }),
          postDeposit('1000'),
          postDeposit('1000'),
        ]);
        for (const response of responses) {
          expect(response.status).toBe(201);
        }
        await close({ countedTotal: '0', justification: 'Le reste' }).expect(
          201,
        );

        const closings = await prisma.cashClosing.findMany();
        expect(closings.reduce((sum, c) => sum + c.depositsTotal, 0n)).toBe(
          5000n,
        );
        expect((await counts()).links).toBe(5);
        await pending()
          .expect(200)
          .expect((r) => expect(r.body.operationCount).toBe(0));
      });

      it('counts each operation once across two parallel closings', async () => {
        await deposit('1000');
        await deposit('2000');

        const responses = await Promise.all([
          close({ countedTotal: '0', justification: 'Première' }),
          close({ countedTotal: '0', justification: 'Seconde' }),
        ]);

        expect(responses.map((r) => r.status)).toEqual([201, 201]);
        expect(
          responses
            .map((r) => Number(r.body.expectedTotal))
            .sort((a, b) => a - b),
        ).toEqual([0, 3000]);
        expect(await counts()).toEqual({ closings: 2, links: 2 });
      });
    });
  });

  describe('the history', () => {
    const history = (path = '', as = manager, store = storeId) =>
      api()
        .get(`/api/v1/stores/${store}/cash-closings${path}`)
        .set('Authorization', as.authorization);

    it('lists the closings newest first, in pages', async () => {
      const first = (await close({ countedTotal: '0' }).expect(201)).body;
      await deposit('3000');
      const second = (await close({ countedTotal: '3000' }).expect(201)).body;

      const all = await history().expect(200);
      expect(all.body).toMatchObject({ total: 2, page: 1 });
      expect(all.body.items.map((c: { id: string }) => c.id)).toEqual([
        second.id,
        first.id,
      ]);

      const page = await history('?page=2&pageSize=1').expect(200);
      expect(page.body).toMatchObject({ total: 2, page: 2, pageSize: 1 });
      expect(page.body.items.map((c: { id: string }) => c.id)).toEqual([
        first.id,
      ]);
    });

    it('gives one closing, the same as when it was made', async () => {
      await deposit('3000');
      const closed = (await close({ countedTotal: '3000' }).expect(201)).body;

      await history(`/${closed.id}`)
        .expect(200)
        .expect((r) => expect(r.body).toEqual(closed));
    });

    it('never shows another store’s closings', async () => {
      const closed = (await close({ countedTotal: '0' }).expect(201)).body;

      await history('', outsider, otherStoreId)
        .expect(200)
        .expect((r) => expect(r.body.total).toBe(0));
      await history(`/${closed.id}`, outsider, otherStoreId)
        .expect(404)
        .expect((r) => expect(r.body.message).toBe('Clôture introuvable'));
    });

    it('answers 404 for an unknown closing, 400 for a malformed id or page', async () => {
      await history(`/${randomUUID()}`)
        .expect(404)
        .expect((r) => expect(r.body.message).toBe('Clôture introuvable'));
      await history('/x-1').expect(400);
      await history('?page=0').expect(400);
    });

    it('is for the manager only: a seller gets 403', async () => {
      const closed = (await close({ countedTotal: '0' }).expect(201)).body;

      await history('', seller)
        .expect(403)
        .expect((r) => expect(r.body.error).toBe('STORE_ROLE_REQUIRED'));
      await history(`/${closed.id}`, seller).expect(403);
    });
  });
});
