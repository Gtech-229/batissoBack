import type { INestApplication } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { createTestApp } from './utils/app.js';
import { createMali, createStoreRecord } from './utils/countries.js';
import { CapturingPushSender } from './utils/push.js';
import { resetDatabase } from './utils/reset-database.js';
import { CapturingSmsSender } from './utils/sms.js';
import { signedInStaff, type MobileStaff } from './utils/staff.js';
import { TEST_PIN } from './utils/users.js';

describe('Disputes (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  const sms = new CapturingSmsSender();
  const push = new CapturingPushSender();
  let storeId: string;
  let otherStoreId: string;
  let outsider: MobileStaff;
  let manager: MobileStaff;
  let seller: MobileStaff;
  let customer: MobileStaff;
  let other: MobileStaff;
  let accountId: string;
  let otherAccountId: string;
  let deposit: { id: string; reference: string };

  beforeAll(async () => {
    app = await createTestApp({ sms, push });
    prisma = app.get(PrismaService);
  });

  beforeEach(async () => {
    await resetDatabase(prisma);
    await createMali(prisma);
    storeId = (await createStoreRecord(prisma, { status: 'VERIFIED' })).id;
    otherStoreId = (await createStoreRecord(prisma, { status: 'VERIFIED' })).id;
    outsider = await signedInStaff(app, prisma, {
      phone: '+22376000002',
      store: { id: otherStoreId, role: 'MANAGER' },
    });
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
    customer = await signedInStaff(app, prisma, {
      phone: '+22376445566',
      firstName: 'Fanta',
    });
    other = await signedInStaff(app, prisma, { phone: '+22376112233' });
    accountId = await openAccount(customer.phone);
    otherAccountId = await openAccount(other.phone);
    deposit = await recordDeposit('50000');
  });

  afterAll(async () => {
    await app.close();
  });

  const api = () => request(app.getHttpServer());
  const openAccount = async (phone: string) =>
    (
      await api()
        .post(`/api/v1/stores/${storeId}/accounts`)
        .set('Authorization', seller.authorization)
        .send({
          customer: { phone, firstName: 'F', lastName: 'K' },
          termsAccepted: true,
        })
        .expect(201)
    ).body.id as string;
  const recordDeposit = async (amount: string, account = accountId) =>
    (
      await api()
        .post(`/api/v1/stores/${storeId}/accounts/${account}/deposits`)
        .set('Authorization', seller.authorization)
        .set('Idempotency-Key', randomUUID())
        .send({ amount })
        .expect(201)
    ).body as { id: string; reference: string };
  /** A purchase debit, through the real 10b flow (prepared, confirmed by PIN). */
  const purchase = async () => {
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
    const confirmed = await api()
      .post(`/api/v1/me/accounts/${accountId}/orders/${order.body.id}/confirm`)
      .set('Authorization', customer.authorization)
      .set('Idempotency-Key', randomUUID())
      .send({ pin: TEST_PIN })
      .expect(201);
    return prisma.operation.findUniqueOrThrow({
      where: { reference: confirmed.body.debitReference as string },
    });
  };
  /** A manager's correction of the deposit, through the real 11a route. */
  const correction = async () =>
    (
      await api()
        .post(
          `/api/v1/stores/${storeId}/accounts/${accountId}/operations/${deposit.id}/corrections`,
        )
        .set('Authorization', manager.authorization)
        .set('Idempotency-Key', randomUUID())
        .send({ amount: '1000', reason: 'Erreur de saisie' })
        .expect(201)
    ).body as { id: string; reference: string };
  const open = (
    operationId: string,
    body: Record<string, unknown> = { message: 'Je n’ai pas versé ce montant' },
    options: { as?: MobileStaff; account?: string } = {},
  ) =>
    api()
      .post(
        `/api/v1/me/accounts/${options.account ?? accountId}/operations/${operationId}/disputes`,
      )
      .set('Authorization', (options.as ?? customer).authorization)
      .send(body);
  const mine = (path = '', as = customer, account = accountId) =>
    api()
      .get(`/api/v1/me/accounts/${account}/disputes${path}`)
      .set('Authorization', as.authorization);
  const staff = (path = '', as = manager, store = storeId) =>
    api()
      .get(`/api/v1/stores/${store}/disputes${path}`)
      .set('Authorization', as.authorization);
  const reply = (
    disputeId: string,
    body: Record<string, unknown> = { message: 'Nous vérifions le cahier.' },
    as = manager,
    store = storeId,
  ) =>
    api()
      .post(`/api/v1/stores/${store}/disputes/${disputeId}/messages`)
      .set('Authorization', as.authorization)
      .send(body);
  /** A dispute opened by the customer on the deposit: its id. */
  const opened = async () =>
    (await open(deposit.id).expect(201)).body.id as string;

  describe('POST /me/accounts/:accountId/operations/:operationId/disputes', () => {
    it('opens a dispute on a deposit with a first message, without staff identity', async () => {
      const response = await open(deposit.id, {
        message: '  Je n’ai versé que 5 000 F, pas 50 000 F. ',
      }).expect(201);

      expect(response.body).toMatchObject({
        id: expect.any(String),
        status: 'OPEN',
        operation: {
          id: deposit.id,
          reference: deposit.reference,
          type: 'DEPOSIT',
          direction: 'CREDIT',
          amount: '50000',
          currencyCode: 'XOF',
        },
        account: { id: accountId },
        store: { id: storeId, name: 'Quincaillerie du Carrefour' },
        closedAt: null,
        messages: [
          {
            author: 'CUSTOMER',
            body: 'Je n’ai versé que 5 000 F, pas 50 000 F.',
            createdAt: expect.any(String),
          },
        ],
      });
      const json = JSON.stringify(response.body);
      for (const id of [customer.userId, seller.userId, manager.userId]) {
        expect(json).not.toContain(id);
      }
      expect(json).not.toContain('authorId');
    });

    it('opens disputes on a purchase debit and on a correction too', async () => {
      const debit = await purchase();
      const corrected = await correction();

      for (const [operationId, type, direction] of [
        [debit.id, 'MATERIAL_DEBIT', 'DEBIT'],
        [corrected.id, 'CORRECTION', 'DEBIT'],
      ]) {
        await open(operationId)
          .expect(201)
          .expect((r) =>
            expect(r.body.operation).toMatchObject({ type, direction }),
          );
      }
    });

    it('refuses a second open dispute on the same operation with 409 DISPUTE_ALREADY_OPEN', async () => {
      await open(deposit.id).expect(201);

      await open(deposit.id, { message: 'Encore moi' })
        .expect(409)
        .expect((r) => expect(r.body.error).toBe('DISPUTE_ALREADY_OPEN'));
      expect(await prisma.dispute.count()).toBe(1);
      expect(await prisma.disputeMessage.count()).toBe(1);
    });

    it('lets a customer of a closed store still dispute', async () => {
      await prisma.hardwareStore.update({
        where: { id: storeId },
        data: { status: 'CLOSED' },
      });

      await open(deposit.id).expect(201);
    });

    it('answers 404 for another customer, staff, and another account’s operation', async () => {
      const othersDeposit = await recordDeposit('2000', otherAccountId);

      for (const as of [other, seller, manager]) {
        await open(deposit.id, undefined, { as })
          .expect(404)
          .expect((r) => expect(r.body.message).toBe('Compte introuvable'));
      }
      // Another account's operation, through the customer's own account.
      await open(othersDeposit.id)
        .expect(404)
        .expect((r) => expect(r.body.message).toBe('Opération introuvable'));
      await open(randomUUID())
        .expect(404)
        .expect((r) => expect(r.body.message).toBe('Opération introuvable'));
      expect(await prisma.dispute.count()).toBe(0);
    });

    it('answers 400 for malformed ids', async () => {
      await open('d-1').expect(400);
      await open(deposit.id, undefined, { account: 'c-1' }).expect(400);
    });

    it.each([
      ['no message', {}],
      ['an empty message', { message: '' }],
      ['a blank message', { message: '   ' }],
      ['a message over 1000 characters', { message: 'x'.repeat(1001) }],
    ])('refuses %s with a French 400', async (_, body) => {
      await open(deposit.id, body)
        .expect(400)
        .expect((r) =>
          expect(r.body.details).toContainEqual({
            field: 'message',
            errors: ['Le message doit contenir 1 à 1000 caractères'],
          }),
        );
      expect(await prisma.dispute.count()).toBe(0);
    });
  });

  describe('GET /me/accounts/:accountId/disputes', () => {
    it('lists the account’s disputes newest first, with a status filter and pages', async () => {
      const first = (await open(deposit.id).expect(201)).body;
      const second = (await open((await recordDeposit('3000')).id).expect(201))
        .body;
      await prisma.dispute.update({
        where: { id: first.id },
        data: { status: 'ANSWERED' },
      });

      const all = await mine().expect(200);
      expect(all.body).toMatchObject({ total: 2, page: 1 });
      expect(all.body.items.map((d: { id: string }) => d.id)).toEqual([
        second.id,
        first.id,
      ]);

      const answered = await mine('?status=ANSWERED').expect(200);
      expect(answered.body.items.map((d: { id: string }) => d.id)).toEqual([
        first.id,
      ]);

      const page = await mine('?page=2&pageSize=1').expect(200);
      expect(page.body).toMatchObject({ total: 2, page: 2, pageSize: 1 });
      expect(page.body.items.map((d: { id: string }) => d.id)).toEqual([
        first.id,
      ]);
    });

    it('lists only this account’s disputes, and refuses a bad status with 400', async () => {
      await open(deposit.id).expect(201);
      const othersDeposit = await recordDeposit('2000', otherAccountId);
      await open(othersDeposit.id, undefined, {
        as: other,
        account: otherAccountId,
      }).expect(201);

      await mine()
        .expect(200)
        .expect((r) => expect(r.body.total).toBe(1));
      await mine('?status=PENDING').expect(400);
      await mine('', other)
        .expect(404)
        .expect((r) => expect(r.body.message).toBe('Compte introuvable'));
    });
  });

  describe('GET /me/accounts/:accountId/disputes/:disputeId', () => {
    it('gives one dispute with its thread', async () => {
      const opened = (await open(deposit.id).expect(201)).body;

      await mine(`/${opened.id}`)
        .expect(200)
        .expect((r) => expect(r.body).toEqual(opened));
    });

    it('answers 404 for another account’s dispute and an unknown one, 400 for a malformed id', async () => {
      const othersDeposit = await recordDeposit('2000', otherAccountId);
      const othersDispute = (
        await open(othersDeposit.id, undefined, {
          as: other,
          account: otherAccountId,
        }).expect(201)
      ).body;

      await mine(`/${othersDispute.id}`)
        .expect(404)
        .expect((r) => expect(r.body.message).toBe('Contestation introuvable'));
      await mine(`/${randomUUID()}`)
        .expect(404)
        .expect((r) => expect(r.body.message).toBe('Contestation introuvable'));
      await mine('/x-1').expect(400);
    });
  });

  describe('the manager’s side: GET /stores/:storeId/disputes and replies', () => {
    it('lists and reads the store’s disputes, with the customer’s name', async () => {
      const disputeId = await opened();
      const othersDeposit = await recordDeposit('2000', otherAccountId);
      await open(othersDeposit.id, undefined, {
        as: other,
        account: otherAccountId,
      }).expect(201);

      const all = await staff().expect(200);
      expect(all.body.total).toBe(2);
      const forAccount = await staff(`?accountId=${accountId}`).expect(200);
      expect(forAccount.body.items.map((d: { id: string }) => d.id)).toEqual([
        disputeId,
      ]);
      expect((await staff('?status=ANSWERED').expect(200)).body.total).toBe(0);

      const detail = await staff(`/${disputeId}`).expect(200);
      expect(detail.body).toMatchObject({
        id: disputeId,
        status: 'OPEN',
        customer: { firstName: 'Fanta', lastName: 'Diallo' },
        operation: { reference: deposit.reference },
        messages: [
          {
            author: 'CUSTOMER',
            authorName: { firstName: 'Fanta', lastName: 'Diallo' },
            body: 'Je n’ai pas versé ce montant',
          },
        ],
      });
      expect(JSON.stringify(detail.body)).not.toContain(customer.phone);
    });

    it('replies: the dispute is ANSWERED, and the customer sees only the store', async () => {
      const disputeId = await opened();

      const answered = await reply(disputeId, {
        message: '  Le cahier montre bien 50 000 F, signé par vous. ',
      }).expect(201);

      expect(answered.body).toMatchObject({
        status: 'ANSWERED',
        messages: [
          { author: 'CUSTOMER' },
          {
            author: 'STORE',
            authorName: { firstName: 'Awa' },
            body: 'Le cahier montre bien 50 000 F, signé par vous.',
          },
        ],
      });
      const seen = await mine(`/${disputeId}`).expect(200);
      expect(seen.body.status).toBe('ANSWERED');
      expect(seen.body.messages[1]).toEqual({
        author: 'STORE',
        body: 'Le cahier montre bien 50 000 F, signé par vous.',
        createdAt: expect.any(String),
      });
      const json = JSON.stringify(seen.body);
      expect(json).not.toContain('Awa');
      expect(json).not.toContain(manager.userId);
    });

    it('is for the manager only: a seller gets 403 STORE_ROLE_REQUIRED', async () => {
      const disputeId = await opened();

      await staff('', seller)
        .expect(403)
        .expect((r) => expect(r.body.error).toBe('STORE_ROLE_REQUIRED'));
      await reply(disputeId, undefined, seller).expect(403);
      expect(await prisma.disputeMessage.count()).toBe(1);
    });

    it('answers 404 for another store’s dispute and a non-member', async () => {
      const disputeId = await opened();

      await staff(`/${disputeId}`, outsider, otherStoreId)
        .expect(404)
        .expect((r) => expect(r.body.message).toBe('Contestation introuvable'));
      await reply(disputeId, undefined, outsider, otherStoreId)
        .expect(404)
        .expect((r) => expect(r.body.message).toBe('Contestation introuvable'));
      await staff('', outsider)
        .expect(404)
        .expect((r) =>
          expect(r.body.message).toBe('Quincaillerie introuvable'),
        );
      await staff(`/${randomUUID()}`).expect(404);
      await staff('/x-1').expect(400);
      expect(await prisma.disputeMessage.count()).toBe(1);
    });

    it('refuses a reply on a closed dispute with 409 DISPUTE_STATUS, and a bad message with 400', async () => {
      const disputeId = await opened();
      await reply(disputeId, { message: '' })
        .expect(400)
        .expect((r) =>
          expect(r.body.details).toContainEqual(
            expect.objectContaining({ field: 'message' }),
          ),
        );
      await prisma.dispute.update({
        where: { id: disputeId },
        data: { status: 'CLOSED', closedAt: new Date() },
      });

      await reply(disputeId)
        .expect(409)
        .expect((r) =>
          expect(r.body).toMatchObject({
            error: 'DISPUTE_STATUS',
            message:
              'Cette contestation est close : ouvrez une nouvelle contestation sur l’opération si besoin',
          }),
        );
      expect(await prisma.disputeMessage.count()).toBe(1);
    });

    it('keeps both of two parallel replies, in order', async () => {
      const disputeId = await opened();

      await Promise.all([
        reply(disputeId, { message: 'Première réponse' }).expect(201),
        reply(disputeId, { message: 'Seconde réponse' }).expect(201),
      ]);

      const detail = await staff(`/${disputeId}`).expect(200);
      expect(detail.body.status).toBe('ANSWERED');
      expect(
        detail.body.messages.map((m: { body: string }) => m.body).slice(1),
      ).toEqual(
        expect.arrayContaining(['Première réponse', 'Seconde réponse']),
      );
      expect(detail.body.messages).toHaveLength(3);
    });
  });

  describe('the customer writes again and closes', () => {
    const write = (
      disputeId: string,
      body: Record<string, unknown> = { message: 'Je maintiens ma demande.' },
      as = customer,
      account = accountId,
    ) =>
      api()
        .post(`/api/v1/me/accounts/${account}/disputes/${disputeId}/messages`)
        .set('Authorization', as.authorization)
        .send(body);
    const close = (disputeId: string, as = customer, account = accountId) =>
      api()
        .post(`/api/v1/me/accounts/${account}/disputes/${disputeId}/close`)
        .set('Authorization', as.authorization);

    it('runs the whole thread: answered, reopened, answered, then closed', async () => {
      const disputeId = await opened();

      await reply(disputeId, { message: 'Le cahier montre 50 000 F.' })
        .expect(201)
        .expect((r) => expect(r.body.status).toBe('ANSWERED'));
      await write(disputeId, { message: '  J’ai mon reçu de 5 000 F. ' })
        .expect(201)
        .expect((r) =>
          expect(r.body).toMatchObject({
            status: 'OPEN',
            messages: [
              { author: 'CUSTOMER' },
              { author: 'STORE' },
              { author: 'CUSTOMER', body: 'J’ai mon reçu de 5 000 F.' },
            ],
          }),
        );
      await reply(disputeId, { message: 'Vu, nous corrigeons.' }).expect(201);

      const closed = await close(disputeId).expect(200);

      expect(closed.body).toMatchObject({
        status: 'CLOSED',
        closedAt: expect.any(String),
      });
      const bodies = [
        'Je n’ai pas versé ce montant',
        'Le cahier montre 50 000 F.',
        'J’ai mon reçu de 5 000 F.',
        'Vu, nous corrigeons.',
      ];
      expect(closed.body.messages.map((m: { body: string }) => m.body)).toEqual(
        bodies,
      );
      const seenByStaff = await staff(`/${disputeId}`).expect(200);
      expect(
        seenByStaff.body.messages.map((m: { body: string }) => m.body),
      ).toEqual(bodies);
      expect(seenByStaff.body.status).toBe('CLOSED');
    });

    it('lets the customer withdraw an open dispute, then open a new one on the operation', async () => {
      const disputeId = await opened();

      await close(disputeId)
        .expect(200)
        .expect((r) => expect(r.body.status).toBe('CLOSED'));
      const again = await open(deposit.id, {
        message: 'Finalement, je conteste encore.',
      }).expect(201);

      expect(again.body.id).not.toBe(disputeId);
      expect(again.body.status).toBe('OPEN');
    });

    it('refuses to write in or close a closed dispute with 409 DISPUTE_STATUS', async () => {
      const disputeId = await opened();
      await close(disputeId).expect(200);
      const messages = await prisma.disputeMessage.count();

      // Lazily: each supertest request is built only when it is sent.
      for (const call of [() => write(disputeId), () => close(disputeId)]) {
        await call()
          .expect(409)
          .expect((r) => expect(r.body.error).toBe('DISPUTE_STATUS'));
      }
      expect(await prisma.disputeMessage.count()).toBe(messages);
    });

    it('answers 404 to another customer, and 400 for a bad message', async () => {
      const disputeId = await opened();

      for (const call of [
        () => write(disputeId, undefined, other),
        () => close(disputeId, other),
      ]) {
        await call()
          .expect(404)
          .expect((r) => expect(r.body.message).toBe('Compte introuvable'));
      }
      // Another customer's dispute, through their own account.
      for (const call of [
        () => write(disputeId, undefined, other, otherAccountId),
        () => close(disputeId, other, otherAccountId),
      ]) {
        await call()
          .expect(404)
          .expect((r) =>
            expect(r.body.message).toBe('Contestation introuvable'),
          );
      }
      await write(disputeId, { message: '   ' }).expect(400);
      await close(randomUUID()).expect(404);
      expect(
        await prisma.dispute.findUniqueOrThrow({ where: { id: disputeId } }),
      ).toMatchObject({ status: 'OPEN', closedAt: null });
      expect(await prisma.disputeMessage.count()).toBe(1);
    });

    it('ends consistently when the customer closes while the manager replies', async () => {
      const disputeId = await opened();

      const [closing, replying] = await Promise.all([
        close(disputeId),
        reply(disputeId, { message: 'Réponse en même temps' }),
      ]);

      expect(closing.status).toBe(200);
      expect([201, 409]).toContain(replying.status);
      const stored = await prisma.dispute.findUniqueOrThrow({
        where: { id: disputeId },
        include: { messages: true },
      });
      expect(stored.status).toBe('CLOSED');
      // The reply landed before the close, or was refused after it.
      expect(stored.messages).toHaveLength(replying.status === 201 ? 2 : 1);
    });
  });

  describe('notifications', () => {
    const rowsOf = (type: string) =>
      prisma.notification.findMany({
        where: { type: type as never },
        orderBy: [{ userId: 'asc' }, { channel: 'asc' }],
      });
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
    const accountNumber = async () =>
      (await prisma.account.findUniqueOrThrow({ where: { id: accountId } }))
        .number;
    const write = (disputeId: string, message: string) =>
      api()
        .post(`/api/v1/me/accounts/${accountId}/disputes/${disputeId}/messages`)
        .set('Authorization', customer.authorization)
        .send({ message });
    const close = (disputeId: string) =>
      api()
        .post(`/api/v1/me/accounts/${accountId}/disputes/${disputeId}/close`)
        .set('Authorization', customer.authorization);

    beforeEach(async () => {
      for (const staffer of [manager, customer]) {
        await prisma.userDevice.updateMany({
          where: { deviceId: staffer.deviceId },
          data: { pushToken: `token-${staffer.userId}` },
        });
      }
      await settled();
      sms.clear();
      push.clear();
    });

    it('tells the active managers of a new dispute, in the app and by push', async () => {
      const former = await signedInStaff(app, prisma, {
        phone: '+22376000009',
        store: { id: storeId, role: 'MANAGER', active: false },
      });

      await open(deposit.id).expect(201);
      await settled();

      const rows = await rowsOf('DISPUTE_OPENED');
      expect(rows.map((row) => [row.userId, row.channel])).toEqual([
        [manager.userId, 'APP'],
        [manager.userId, 'PUSH'],
      ]);
      expect(rows[0]).toMatchObject({
        title: 'Nouvelle contestation',
        body: `Contestation ouverte sur l’opération ${deposit.reference} du compte ${await accountNumber()} : « Je n’ai pas versé ce montant ».`,
        storeId,
        operationId: deposit.id,
      });
      const recipients = rows.map((row) => row.userId);
      expect(recipients).not.toContain(seller.userId);
      expect(recipients).not.toContain(former.userId);
      expect(push.messages).toEqual([
        expect.objectContaining({ title: 'Nouvelle contestation' }),
      ]);
      expect(sms.messages).toEqual([]);
    });

    it('tells the customer of a reply by the store’s name, and the managers of each customer step', async () => {
      const disputeId = (await open(deposit.id).expect(201)).body.id as string;
      const number = await accountNumber();

      await reply(disputeId, { message: 'Le cahier montre 50 000 F.' }).expect(
        201,
      );
      await write(disputeId, 'J’ai mon reçu.').expect(201);
      await close(disputeId).expect(200);
      await settled();

      const replies = await rowsOf('DISPUTE_STORE_REPLY');
      expect(replies.map((row) => [row.userId, row.channel])).toEqual([
        [customer.userId, 'APP'],
        [customer.userId, 'PUSH'],
      ]);
      expect(replies[0]).toMatchObject({
        title: 'Réponse à votre contestation',
        body: `Réponse de Quincaillerie du Carrefour à votre contestation sur l’opération ${deposit.reference} : « Le cahier montre 50 000 F. ».`,
        operationId: deposit.id,
      });
      expect(replies[0].body).not.toContain('Awa');

      expect((await rowsOf('DISPUTE_CUSTOMER_MESSAGE'))[0]).toMatchObject({
        userId: manager.userId,
        title: 'Contestation : nouveau message du client',
        body: `Le client du compte ${number} a écrit dans sa contestation sur l’opération ${deposit.reference} : « J’ai mon reçu. ».`,
      });
      expect((await rowsOf('DISPUTE_CLOSED'))[0]).toMatchObject({
        userId: manager.userId,
        title: 'Contestation close',
        body: `Le client du compte ${number} a clos sa contestation sur l’opération ${deposit.reference}.`,
      });
      expect(sms.messages).toEqual([]);
    });

    it('cuts a long message in the notification, and keeps it whole in the thread', async () => {
      const long = `${'a'.repeat(199)} ${'b'.repeat(300)}`;

      const opened = await open(deposit.id, { message: long }).expect(201);
      await settled();

      expect(opened.body.messages[0].body).toBe(long);
      expect((await rowsOf('DISPUTE_OPENED'))[0].body).toBe(
        `Contestation ouverte sur l’opération ${deposit.reference} du compte ${await accountNumber()} : « ${'a'.repeat(199)}… ».`,
      );
    });

    it('tells nobody when a step is refused', async () => {
      const disputeId = (await open(deposit.id).expect(201)).body.id as string;
      await close(disputeId).expect(200);
      // An open dispute on another operation, for the duplicate-open refusal.
      const second = await recordDeposit('3000');
      await open(second.id).expect(201);
      await settled();
      const before = await prisma.notification.count();
      const openedBefore = (await rowsOf('DISPUTE_OPENED')).length;

      await open(randomUUID()).expect(404);
      // Refused after its transaction started writing (F-17).
      await open(second.id, { message: 'Encore une fois' })
        .expect(409)
        .expect((r) => expect(r.body.error).toBe('DISPUTE_ALREADY_OPEN'));
      await reply(disputeId).expect(409);
      await write(disputeId, 'Encore').expect(409);
      await close(disputeId).expect(409);
      await reply(disputeId, undefined, seller).expect(403);
      await settled();

      expect(await prisma.notification.count()).toBe(before);
      expect(await rowsOf('DISPUTE_OPENED')).toHaveLength(openedBefore);
    });

    it('opens once out of two parallel disputes on one operation (F-17)', async () => {
      const responses = await Promise.all([
        open(deposit.id, { message: 'Premier' }),
        open(deposit.id, { message: 'Second' }),
      ]);
      await settled();

      expect(
        responses
          .map((r) => [r.status, r.status === 409 ? r.body.error : null])
          .sort((a, b) => Number(a[0]) - Number(b[0])),
      ).toEqual([
        [201, null],
        [409, 'DISPUTE_ALREADY_OPEN'],
      ]);
      expect(await prisma.dispute.count()).toBe(1);
      expect(await prisma.disputeMessage.count()).toBe(1);
      // One set of alert rows: the active manager, in the app and by push.
      expect(
        (await rowsOf('DISPUTE_OPENED')).map((row) => [
          row.userId,
          row.channel,
        ]),
      ).toEqual([
        [manager.userId, 'APP'],
        [manager.userId, 'PUSH'],
      ]);
    });
  });
});
