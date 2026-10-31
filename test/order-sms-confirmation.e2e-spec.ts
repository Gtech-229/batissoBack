import { Logger, type INestApplication } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { createTestApp } from './utils/app.js';
import { createMali, createStoreRecord } from './utils/countries.js';
import { resetDatabase } from './utils/reset-database.js';
import { CapturingSmsSender } from './utils/sms.js';
import { signedInStaff, type MobileStaff } from './utils/staff.js';

describe('Confirming an order with an SMS code (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  const sms = new CapturingSmsSender();
  let storeId: string;
  let otherStoreId: string;
  let manager: MobileStaff;
  let seller: MobileStaff;
  let outsider: MobileStaff;
  let customer: MobileStaff;
  let accountId: string;
  let cementId: string;

  beforeAll(async () => {
    app = await createTestApp({ sms });
    prisma = app.get(PrismaService);
  });

  beforeEach(async () => {
    await resetDatabase(prisma);
    await createMali(prisma);
    storeId = (await createStoreRecord(prisma, { status: 'VERIFIED' })).id;
    otherStoreId = (await createStoreRecord(prisma, { status: 'VERIFIED' })).id;
    manager = await signedInStaff(app, prisma, {
      phone: '+22376000000',
      store: { id: storeId, role: 'MANAGER' },
    });
    seller = await signedInStaff(app, prisma, {
      phone: '+22376000001',
      store: { id: storeId, role: 'SELLER' },
    });
    outsider = await signedInStaff(app, prisma, {
      phone: '+22376000002',
      store: { id: otherStoreId, role: 'MANAGER' },
    });
    customer = await signedInStaff(app, prisma, { phone: '+22376445566' });
    accountId = (
      await api()
        .post(`/api/v1/stores/${storeId}/accounts`)
        .set('Authorization', seller.authorization)
        .send({
          customer: { phone: customer.phone, firstName: 'F', lastName: 'K' },
          termsAccepted: true,
        })
        .expect(201)
    ).body.id as string;
    await api()
      .post(`/api/v1/stores/${storeId}/accounts/${accountId}/deposits`)
      .set('Authorization', seller.authorization)
      .set('Idempotency-Key', randomUUID())
      .send({ amount: '100000' })
      .expect(201);
    const categoryId = (
      await prisma.articleCategory.create({ data: { storeId, name: 'Ciment' } })
    ).id;
    cementId = (
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
    sms.clear();
  });

  afterAll(async () => {
    await app.close();
  });

  const api = () => request(app.getHttpServer());
  /** 4 bags = 20 000, under the threshold: the order awaits the customer. */
  const prepare = async (bags = 4) =>
    (
      await api()
        .post(`/api/v1/stores/${storeId}/accounts/${accountId}/orders`)
        .set('Authorization', seller.authorization)
        .send({ lines: [{ articleId: cementId, quantity: bags }] })
        .expect(201)
    ).body as { id: string; reference: string; status: string };
  const requestCode = (orderId: string, as = seller, store = storeId) =>
    api()
      .post(`/api/v1/stores/${store}/orders/${orderId}/confirmation-code`)
      .set('Authorization', as.authorization);
  const confirm = (
    orderId: string,
    code: string,
    options: { key?: string; as?: MobileStaff } = {},
  ) =>
    api()
      .post(`/api/v1/stores/${storeId}/orders/${orderId}/confirm`)
      .set('Authorization', (options.as ?? seller).authorization)
      .set('Idempotency-Key', options.key ?? randomUUID())
      .send({ code });
  const codeOf = () => sms.lastCodeFor(customer.phone);
  const codes = (orderId: string) =>
    prisma.orderConfirmationCode.findMany({
      where: { orderId },
      orderBy: { createdAt: 'asc' },
    });
  /** Ages the order's codes so the next request passes the cooldown. */
  const ageCodes = (orderId: string) =>
    prisma.orderConfirmationCode.updateMany({
      where: { orderId },
      data: { createdAt: new Date(Date.now() - 61_000) },
    });
  const debits = () =>
    prisma.operation.count({ where: { type: 'MATERIAL_DEBIT' } });
  const wrong = (code: string) => (code === '000000' ? '000001' : '000000');

  describe('POST .../orders/:orderId/confirmation-code', () => {
    it('texts the customer a code naming the order, the amount, and the store', async () => {
      const order = await prepare();
      const before = Date.now();

      const response = await requestCode(order.id).expect(201);

      const expiresAt = new Date(response.body.expiresAt).getTime();
      expect(expiresAt - before).toBeGreaterThanOrEqual(9 * 60_000);
      expect(expiresAt - before).toBeLessThanOrEqual(11 * 60_000);
      expect(sms.messages).toEqual([
        {
          phone: customer.phone,
          text: `Bâtisso : code ${codeOf()} pour confirmer le bon ${order.reference} de 20 000 XOF chez Quincaillerie du Carrefour. Valable 10 minutes. Donnez-le au vendeur seulement pour confirmer cet achat.`,
        },
      ]);
      const [stored] = await codes(order.id);
      // Stored hashed, never as typed.
      expect(stored.codeHash).not.toContain(codeOf());
      expect(stored).toMatchObject({
        attempts: 0,
        consumedAt: null,
        requestedById: seller.userId,
      });
    });

    it('refuses a second code within a minute with 409 CODE_COOLDOWN', async () => {
      const order = await prepare();
      await requestCode(order.id).expect(201);

      await requestCode(order.id)
        .expect(409)
        .expect((r) => expect(r.body.error).toBe('CODE_COOLDOWN'));
      expect(await codes(order.id)).toHaveLength(1);
    });

    it('refuses a sixth code with 409 CODE_LIMIT', async () => {
      const order = await prepare();
      for (let i = 0; i < 5; i++) {
        await ageCodes(order.id);
        await requestCode(order.id).expect(201);
      }
      await ageCodes(order.id);

      await requestCode(order.id)
        .expect(409)
        .expect((r) => expect(r.body.error).toBe('CODE_LIMIT'));
    });

    it('refuses an order that does not await the customer', async () => {
      // 50 bags = 250 000: a seller's order waits for the manager.
      await api()
        .post(`/api/v1/stores/${storeId}/accounts/${accountId}/deposits`)
        .set('Authorization', seller.authorization)
        .set('Idempotency-Key', randomUUID())
        .send({ amount: '200000' })
        .expect(201);
      const order = await prepare(50);
      // The deposit's own SMS; the assertion below is about codes only.
      sms.clear();

      await requestCode(order.id)
        .expect(409)
        .expect((r) => expect(r.body.error).toBe('ORDER_STATUS'));
      expect(sms.messages).toEqual([]);
    });

    it('answers 404 to another store and for another store’s order', async () => {
      const order = await prepare();

      await requestCode(order.id, outsider).expect(404);
      await requestCode(order.id, outsider, otherStoreId)
        .expect(404)
        .expect((r) => expect(r.body.message).toBe('Bon introuvable'));
      expect(sms.messages).toEqual([]);
    });

    it('still answers when the SMS provider fails', async () => {
      const order = await prepare();
      sms.mode = 'reject';
      const logged = vi
        .spyOn(Logger.prototype, 'error')
        .mockImplementation(() => {});

      await requestCode(order.id).expect(201);
      expect(await codes(order.id)).toHaveLength(1);

      // The failure is logged once the rejection settles, phone masked, no code.
      await vi.waitFor(() => expect(logged).toHaveBeenCalledTimes(1));
      const line = JSON.stringify(logged.mock.calls);
      logged.mockRestore();
      expect(line).not.toContain(customer.phone);
      expect(line).not.toContain(codeOf());
    });
  });

  describe('POST .../orders/:orderId/confirm', () => {
    it('debits the account with the right code, confirmed via SMS_CODE', async () => {
      const order = await prepare();
      await requestCode(order.id).expect(201);

      const response = await confirm(order.id, codeOf()).expect(201);

      expect(response.body).toMatchObject({
        id: order.id,
        status: 'CONFIRMED',
        confirmedVia: 'SMS_CODE',
        debitReference: expect.stringMatching(/^A-\d{5,}$/),
      });
      expect(
        await prisma.operation.findFirstOrThrow({
          where: { type: 'MATERIAL_DEBIT' },
        }),
      ).toMatchObject({
        amount: 20000n,
        balanceAfter: 80000n,
        authorId: seller.userId,
        device: seller.deviceId,
      });
      expect((await codes(order.id))[0].consumedAt).not.toBeNull();
    });

    it('lets the manager enter the code too', async () => {
      const order = await prepare();
      await requestCode(order.id).expect(201);

      await confirm(order.id, codeOf(), { as: manager }).expect(201);
    });

    it('refuses a wrong code with 400 INVALID_CODE and counts it', async () => {
      const order = await prepare();
      await requestCode(order.id).expect(201);

      const response = await confirm(order.id, wrong(codeOf())).expect(400);

      expect(response.body).toMatchObject({
        error: 'INVALID_CODE',
        message: 'Code incorrect ou expiré : demandez un nouveau code',
      });
      expect((await codes(order.id))[0].attempts).toBe(1);
      expect(await debits()).toBe(0);
    });

    it('uses the code up after 5 wrong entries', async () => {
      const order = await prepare();
      await requestCode(order.id).expect(201);
      const code = codeOf();
      for (let i = 0; i < 5; i++) {
        await confirm(order.id, wrong(code)).expect(400);
      }

      await confirm(order.id, code)
        .expect(400)
        .expect((r) => expect(r.body.error).toBe('INVALID_CODE'));
      expect(await debits()).toBe(0);
    });

    it('refuses an expired code', async () => {
      const order = await prepare();
      await requestCode(order.id).expect(201);
      await prisma.orderConfirmationCode.updateMany({
        where: { orderId: order.id },
        data: { expiresAt: new Date(Date.now() - 1000) },
      });

      await confirm(order.id, codeOf())
        .expect(400)
        .expect((r) => expect(r.body.error).toBe('INVALID_CODE'));
      expect(await debits()).toBe(0);
    });

    it('accepts only the newest code', async () => {
      const order = await prepare();
      await requestCode(order.id).expect(201);
      const first = codeOf();
      await ageCodes(order.id);
      await requestCode(order.id).expect(201);
      const second = codeOf();

      if (first !== second) {
        await confirm(order.id, first).expect(400);
      }
      await confirm(order.id, second).expect(201);
    });

    it('refuses any code before one was requested', async () => {
      const order = await prepare();

      await confirm(order.id, '123456').expect(400);
    });

    it('keeps the code usable when the debit is refused, then debits once the money is back', async () => {
      const order = await prepare();
      await requestCode(order.id).expect(201);
      const goalId = (
        await api()
          .post(`/api/v1/me/accounts/${accountId}/goals`)
          .set('Authorization', customer.authorization)
          .send({ label: 'Fer', targetAmount: '200000' })
          .expect(201)
      ).body.id as string;
      const unassignedId = (
        await prisma.goal.findFirstOrThrow({
          where: { accountId, isSystem: true },
        })
      ).id;
      const move = (from: string, to: string) =>
        api()
          .post(`/api/v1/me/accounts/${accountId}/goal-movements`)
          .set('Authorization', customer.authorization)
          .set('Idempotency-Key', randomUUID())
          .send({ sourceGoalId: from, targetGoalId: to, amount: '90000' })
          .expect(201);
      await move(unassignedId, goalId);

      await confirm(order.id, codeOf())
        .expect(409)
        .expect((r) => expect(r.body.error).toBe('INSUFFICIENT_BALANCE'));
      expect((await codes(order.id))[0].consumedAt).toBeNull();

      await move(goalId, unassignedId);
      await confirm(order.id, codeOf()).expect(201);
    });

    it('answers a retry with the same key with 200, even with the code used', async () => {
      const order = await prepare();
      await requestCode(order.id).expect(201);
      const key = randomUUID();
      const first = await confirm(order.id, codeOf(), { key }).expect(201);

      const retry = await confirm(order.id, codeOf(), { key }).expect(200);

      expect(retry.body).toEqual(first.body);
      expect(await debits()).toBe(1);
    });

    it('debits once when the same code is entered twice in parallel', async () => {
      const order = await prepare();
      await requestCode(order.id).expect(201);
      const code = codeOf();

      const responses = await Promise.all([
        confirm(order.id, code),
        confirm(order.id, code),
      ]);

      const [loser, ...others] = responses.filter((r) => r.status !== 201);
      expect(others).toEqual([]);
      expect(responses.filter((r) => r.status === 201)).toHaveLength(1);
      // The code was used, or the order was confirmed, by the winner.
      expect([
        [400, 'INVALID_CODE'],
        [409, 'ORDER_STATUS'],
      ]).toContainEqual([loser.status, loser.body.error]);
      expect(await debits()).toBe(1);
    });

    it('answers 404 to another store’s member, and refuses a malformed code', async () => {
      const order = await prepare();
      await requestCode(order.id).expect(201);

      await confirm(order.id, codeOf(), { as: outsider }).expect(404);
      await confirm(order.id, '12ab')
        .expect(400)
        .expect((r) =>
          expect(r.body.details).toContainEqual(
            expect.objectContaining({ field: 'code' }),
          ),
        );
      expect(await debits()).toBe(0);
    });
  });
});
