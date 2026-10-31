import type { INestApplication } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { createTestApp } from './utils/app.js';
import { createMali, createStoreRecord } from './utils/countries.js';
import { clearProofs, GIF, JPEG, PNG, storedProofs } from './utils/photos.js';
import { resetDatabase } from './utils/reset-database.js';
import { signedInStaff, type MobileStaff } from './utils/staff.js';

const UNKNOWN_ID = '0192f0a4-7b1c-7c3e-9d2a-5e6f7a8b9c0d';

interface View {
  id: string;
  createdAt: string;
  uploadedBy: string;
}

describe('Transaction proofs (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let storeId: string;
  let otherStoreId: string;
  let manager: MobileStaff;
  let seller: MobileStaff;
  let outsider: MobileStaff;
  let customer: MobileStaff;
  let accountId: string;
  let goalId: string;
  let operationId: string;
  let orderId: string;

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
  });

  beforeEach(async () => {
    await resetDatabase(prisma);
    await clearProofs();
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
      firstName: 'Ibrahim',
      store: { id: otherStoreId, role: 'MANAGER' },
    });
    customer = await signedInStaff(app, prisma, {
      phone: '+22376445566',
      firstName: 'Fanta',
    });
    accountId = (
      (
        await api()
          .post(`/api/v1/stores/${storeId}/accounts`)
          .set('Authorization', seller.authorization)
          .send({
            customer: { phone: customer.phone, firstName: 'F', lastName: 'K' },
            termsAccepted: true,
          })
          .expect(201)
      ).body as { id: string }
    ).id;
    goalId = (await prisma.goal.findFirstOrThrow({ where: { accountId } })).id;
    operationId = (
      (
        await api()
          .post(`/api/v1/stores/${storeId}/accounts/${accountId}/deposits`)
          .set('Authorization', seller.authorization)
          .set('Idempotency-Key', randomUUID())
          .send({ amount: '5000' })
          .expect(201)
      ).body as { id: string }
    ).id;
    orderId = (
      await prisma.materialOrder.create({
        data: {
          reference: 'B-00001',
          storeId,
          accountId,
          goalId,
          status: 'AWAITING_CUSTOMER',
          total: 1000n,
          createdById: seller.userId,
        },
      })
    ).id;
  });

  afterAll(async () => {
    await clearProofs();
    await app.close();
  });

  const api = () => request(app.getHttpServer());

  const operationPath = (store = storeId, account = accountId) =>
    `/api/v1/stores/${store}/accounts/${account}/operations/${operationId}/proofs`;
  const orderPath = (store = storeId, order = orderId) =>
    `/api/v1/stores/${store}/orders/${order}/proofs`;

  const attach = (path: string, as = seller, content = JPEG) =>
    api()
      .post(path)
      .set('Authorization', as.authorization)
      .attach('photo', content, { filename: 'recu.jpg' });

  const list = (path: string, as = seller) =>
    api().get(path).set('Authorization', as.authorization);

  const fileOf = (proofId: string, as = seller, store = storeId) =>
    api()
      .get(`/api/v1/stores/${store}/proofs/${proofId}/file`)
      .set('Authorization', as.authorization);

  const errorOf = (res: { body: unknown }) =>
    (res.body as { error: string }).error;

  describe.each([
    ['a deposit', () => operationPath()],
    ['an order', () => orderPath()],
  ])('on %s', (_, path) => {
    it('attaches a photo for a seller, and shows it to the manager', async () => {
      const res = await attach(path()).expect(201);

      const view = res.body as View;
      expect(Object.keys(view).sort()).toEqual([
        'createdAt',
        'id',
        'uploadedBy',
      ]);
      expect(view.uploadedBy).toBe('STORE');
      expect((await storedProofs()).length).toBe(1);

      const listed = await list(path(), manager).expect(200);
      expect(listed.body).toEqual([view]);
    });

    it('allows a manager too, lists oldest first, and keeps 5 at most', async () => {
      const ids: string[] = [];
      for (let i = 0; i < 5; i += 1) {
        const res = await attach(path(), manager).expect(201);
        ids.push((res.body as View).id);
      }

      const refused = await attach(path(), manager).expect(409);

      expect(errorOf(refused)).toBe('PROOF_LIMIT_REACHED');
      expect((await storedProofs()).length).toBe(5);
      const listed = await list(path()).expect(200);
      expect((listed.body as View[]).map((view) => view.id)).toEqual(ids);
    });

    it('keeps 5 at most under parallel uploads, with no file left behind', async () => {
      const statuses = await Promise.all(
        [1, 2, 3, 4, 5, 6, 7].map(() =>
          attach(path()).then((res) => res.status),
        ),
      );

      expect(statuses.filter((status) => status === 201)).toHaveLength(5);
      expect(statuses.filter((status) => status === 409)).toHaveLength(2);
      expect((await storedProofs()).length).toBe(5);
      expect(await prisma.transactionProof.count()).toBe(5);
    });

    it('refuses a file that is not an image, whatever its name says', async () => {
      await attach(path(), seller, GIF).expect(400);
      await attach(path(), seller, Buffer.from('texte', 'utf8')).expect(400);

      expect(await storedProofs()).toEqual([]);
      expect(await prisma.transactionProof.count()).toBe(0);
    });

    it('refuses a missing photo, and a photo over 5 MB', async () => {
      await api()
        .post(path())
        .set('Authorization', seller.authorization)
        .expect(400);
      await attach(
        path(),
        seller,
        Buffer.concat([JPEG, Buffer.alloc(5 * 1024 * 1024)]),
      ).expect(400);

      expect(await storedProofs()).toEqual([]);
    });

    it('refuses a closed store, and leaves no file', async () => {
      await prisma.hardwareStore.update({
        where: { id: storeId },
        data: { status: 'CLOSED' },
      });

      await attach(path()).expect(409);

      expect(await storedProofs()).toEqual([]);
      await list(path()).expect(200);
    });

    it('accepts a suspended store', async () => {
      await prisma.hardwareStore.update({
        where: { id: storeId },
        data: { status: 'SUSPENDED' },
      });

      await attach(path()).expect(201);
    });

    it('answers 404 to a member of another store, leaving no file', async () => {
      await attach(path(), outsider).expect(404);
      await list(path(), outsider).expect(404);

      expect(await storedProofs()).toEqual([]);
    });

    it('needs a session', async () => {
      await api().get(path()).expect(401);
      await api().post(path()).attach('photo', JPEG, 'a.jpg').expect(401);
    });

    it('writes one activity row without the file name', async () => {
      const { body } = await attach(path()).expect(201);
      const [fileName] = await storedProofs();

      const log = await prisma.activityLog.findFirstOrThrow({
        where: { action: 'PROOF_ATTACHED' },
      });

      expect(log.storeId).toBe(storeId);
      expect(log.userId).toBe(seller.userId);
      expect(log.device).toBe(seller.deviceId);
      expect(log.newValue).toMatchObject({ proofId: (body as View).id });
      expect(JSON.stringify(log)).not.toContain(fileName);
    });

    it('changes nothing else', async () => {
      const before = await prisma.operation.findMany();
      const account = await prisma.account.findUniqueOrThrow({
        where: { id: accountId },
      });

      await attach(path()).expect(201);

      expect(await prisma.operation.findMany()).toEqual(before);
      expect(
        await prisma.account.findUniqueOrThrow({ where: { id: accountId } }),
      ).toEqual(account);
    });
  });

  it('counts each target apart', async () => {
    for (let i = 0; i < 5; i += 1) {
      await attach(operationPath()).expect(201);
    }

    await attach(orderPath()).expect(201);
  });

  it('refuses an operation that is not a deposit', async () => {
    const debit = await prisma.operation.create({
      data: {
        reference: 'A-00001',
        accountId,
        storeId,
        goalId,
        type: 'MATERIAL_DEBIT',
        amount: 1000n,
        direction: 'DEBIT',
        currencyCode: 'XOF',
        balanceBefore: 5000n,
        balanceAfter: 4000n,
        status: 'CONFIRMED',
        channel: 'CASH',
        authorId: seller.userId,
        idempotencyKey: randomUUID(),
      },
    });
    const path = `/api/v1/stores/${storeId}/accounts/${accountId}/operations/${debit.id}/proofs`;

    const res = await attach(path).expect(409);

    expect(errorOf(res)).toBe('PROOF_TARGET_NOT_ALLOWED');
    expect(await storedProofs()).toEqual([]);
  });

  it('answers 404 for an unknown target, and for another account', async () => {
    const other = await signedInStaff(app, prisma, { phone: '+22376445577' });
    const otherAccount = (
      (
        await api()
          .post(`/api/v1/stores/${storeId}/accounts`)
          .set('Authorization', seller.authorization)
          .send({
            customer: { phone: other.phone, firstName: 'O', lastName: 'K' },
            termsAccepted: true,
          })
          .expect(201)
      ).body as { id: string }
    ).id;

    await attach(operationPath(storeId, otherAccount)).expect(404);
    await attach(orderPath(storeId, UNKNOWN_ID)).expect(404);

    expect(await storedProofs()).toEqual([]);
  });

  it('answers 400 for a malformed id', async () => {
    await attach(orderPath(storeId, 'not-a-uuid')).expect(400);
    await fileOf('not-a-uuid').expect(400);
  });

  describe('GET .../proofs/:proofId/file', () => {
    it('gives back the image, uncached, with its real type', async () => {
      const { body } = await attach(orderPath(), seller, PNG).expect(201);

      const res = await fileOf((body as View).id, manager).expect(200);

      expect(res.headers['content-type']).toContain('image/png');
      expect(res.headers['cache-control']).toBe('no-store');
      expect(res.headers['x-content-type-options']).toBe('nosniff');
      expect(res.headers['content-disposition']).toContain('inline');
      expect(Buffer.compare(res.body as Buffer, PNG)).toBe(0);
    });

    it('answers 404 for another store and an unknown proof', async () => {
      const { body } = await attach(orderPath()).expect(201);

      await fileOf((body as View).id, outsider, otherStoreId).expect(404);
      await fileOf(UNKNOWN_ID).expect(404);
    });

    it('answers 404 when the file is gone from the disk', async () => {
      const { body } = await attach(orderPath()).expect(201);
      await clearProofs();

      await fileOf((body as View).id).expect(404);
    });
  });

  describe('the account holder', () => {
    const myOperation = (account = accountId) =>
      `/api/v1/me/accounts/${account}/operations/${operationId}/proofs`;
    const myOrder = (account = accountId) =>
      `/api/v1/me/accounts/${account}/orders/${orderId}/proofs`;
    const myFile = (proofId: string, as = customer, account = accountId) =>
      api()
        .get(`/api/v1/me/accounts/${account}/proofs/${proofId}/file`)
        .set('Authorization', as.authorization);

    it.each([
      ['a deposit', () => myOperation()],
      ['an order', () => myOrder()],
    ])('attaches a photo to %s and sees it', async (_, path) => {
      const res = await attach(path(), customer, PNG).expect(201);

      const view = res.body as View;
      expect(view.uploadedBy).toBe('CUSTOMER');
      const listed = await list(path(), customer).expect(200);
      expect(listed.body).toEqual([view]);
      const file = await myFile(view.id).expect(200);
      expect(file.headers['content-type']).toContain('image/png');
      expect(file.headers['cache-control']).toBe('no-store');
    });

    it('shares the proofs and the limit with the store', async () => {
      const mine = await attach(myOrder(), customer).expect(201);
      const theirs = await attach(orderPath(), seller).expect(201);
      for (let i = 0; i < 3; i += 1) {
        await attach(orderPath(), seller).expect(201);
      }

      const refused = await attach(myOrder(), customer).expect(409);
      expect(errorOf(refused)).toBe('PROOF_LIMIT_REACHED');

      const store = await list(orderPath(), seller).expect(200);
      const seen = (store.body as View[]).map((view) => view.uploadedBy);
      expect(seen[0]).toBe('CUSTOMER');
      expect(seen[1]).toBe('STORE');
      await myFile((theirs.body as View).id).expect(200);
      await fileOf((mine.body as View).id).expect(200);
    });

    it('shows no staff name, path, or file name', async () => {
      await attach(orderPath(), seller).expect(201);
      const [fileName] = await storedProofs();

      const res = await list(myOrder(), customer).expect(200);

      const body = JSON.stringify(res.body);
      expect(body).not.toContain('Moussa');
      expect(body).not.toContain(fileName);
      expect(body).not.toContain('storage');
      expect(Object.keys((res.body as View[])[0]).sort()).toEqual([
        'createdAt',
        'id',
        'uploadedBy',
      ]);
    });

    it('logs the customer as the author, in the store', async () => {
      await attach(myOperation(), customer).expect(201);

      const log = await prisma.activityLog.findFirstOrThrow({
        where: { action: 'PROOF_ATTACHED' },
      });

      expect(log.userId).toBe(customer.userId);
      expect(log.storeId).toBe(storeId);
    });

    it('answers 404 on another customer’s account, leaving no file', async () => {
      const other = await signedInStaff(app, prisma, { phone: '+22376445577' });
      const { body } = await attach(orderPath()).expect(201);

      await attach(myOperation(), other).expect(404);
      await attach(myOrder(), other).expect(404);
      await list(myOrder(), other).expect(404);
      await myFile((body as View).id, other).expect(404);

      expect((await storedProofs()).length).toBe(1);
    });

    it('answers 404 for a target of another of my accounts', async () => {
      const seller2 = await signedInStaff(app, prisma, {
        phone: '+22376000005',
        store: { id: otherStoreId, role: 'SELLER' },
      });
      const elsewhere = (
        (
          await api()
            .post(`/api/v1/stores/${otherStoreId}/accounts`)
            .set('Authorization', seller2.authorization)
            .send({
              customer: {
                phone: customer.phone,
                firstName: 'F',
                lastName: 'K',
              },
              termsAccepted: true,
            })
            .expect(201)
        ).body as { id: string }
      ).id;

      await attach(myOrder(elsewhere), customer).expect(404);
      await attach(myOperation(elsewhere), customer).expect(404);

      const { body } = await attach(orderPath()).expect(201);
      await myFile((body as View).id, customer, elsewhere).expect(404);
      expect((await storedProofs()).length).toBe(1);
    });

    it('refuses a bad file and a closed store, leaving no file', async () => {
      await attach(myOrder(), customer, GIF).expect(400);
      await prisma.hardwareStore.update({
        where: { id: storeId },
        data: { status: 'CLOSED' },
      });

      await attach(myOrder(), customer).expect(409);

      expect(await storedProofs()).toEqual([]);
      await list(myOrder(), customer).expect(200);
    });

    it('needs a session, and refuses a malformed id', async () => {
      await api().get(myOrder()).expect(401);
      await list(myOrder('not-a-uuid'), customer).expect(400);
      await myFile('not-a-uuid').expect(400);
    });
  });

  describe('DELETE /stores/:storeId/proofs/:proofId', () => {
    const REASON = 'Photo du reçu d’un autre client';

    const remove = (
      proofId: string,
      as: MobileStaff = manager,
      body: object = { reason: REASON },
      store = storeId,
    ) =>
      api()
        .delete(`/api/v1/stores/${store}/proofs/${proofId}`)
        .set('Authorization', as.authorization)
        .send(body);

    const attached = async () =>
      ((await attach(orderPath()).expect(201)).body as View).id;

    it('deletes the file, keeps the row, and logs who and why', async () => {
      const id = await attached();
      const [fileName] = await storedProofs();

      await remove(id).expect(204);

      expect(await storedProofs()).toEqual([]);
      const row = await prisma.transactionProof.findUniqueOrThrow({
        where: { id },
      });
      expect(row).toMatchObject({
        fileName: null,
        removedById: manager.userId,
        removalReason: REASON,
      });
      expect(row.removedAt).not.toBeNull();
      const log = await prisma.activityLog.findFirstOrThrow({
        where: { action: 'PROOF_REMOVED' },
      });
      expect(log.storeId).toBe(storeId);
      expect(log.userId).toBe(manager.userId);
      expect(log.device).toBe(manager.deviceId);
      expect(log.newValue).toEqual({ proofId: id, reason: REASON });
      expect(JSON.stringify(log)).not.toContain(fileName);
    });

    it('takes it out of every view, for the store and the customer', async () => {
      const id = await attached();

      await remove(id).expect(204);

      const store = await list(orderPath()).expect(200);
      expect(store.body).toEqual([]);
      const mine = await list(
        `/api/v1/me/accounts/${accountId}/orders/${orderId}/proofs`,
        customer,
      ).expect(200);
      expect(mine.body).toEqual([]);
      await fileOf(id).expect(404);
      await api()
        .get(`/api/v1/me/accounts/${accountId}/proofs/${id}/file`)
        .set('Authorization', customer.authorization)
        .expect(404);
    });

    it('frees a slot', async () => {
      const id = await attached();
      for (let i = 0; i < 4; i += 1) {
        await attach(orderPath()).expect(201);
      }
      await attach(orderPath()).expect(409);

      await remove(id).expect(204);

      await attach(orderPath()).expect(201);
    });

    it('removes a customer’s proof too, and works in a closed store', async () => {
      const mine = await attach(
        `/api/v1/me/accounts/${accountId}/orders/${orderId}/proofs`,
        customer,
      ).expect(201);
      await prisma.hardwareStore.update({
        where: { id: storeId },
        data: { status: 'CLOSED' },
      });

      await remove((mine.body as View).id).expect(204);

      expect(await storedProofs()).toEqual([]);
    });

    it('refuses a seller and leaves the proof', async () => {
      const id = await attached();

      const res = await remove(id, seller).expect(403);

      expect(errorOf(res)).toBe('STORE_ROLE_REQUIRED');
      expect((await storedProofs()).length).toBe(1);
    });

    it('answers 404 to the customer, who is not of the store', async () => {
      const id = await attached();

      await remove(id, customer).expect(404);

      expect((await storedProofs()).length).toBe(1);
    });

    it('answers 404 to a manager of another store', async () => {
      const id = await attached();

      await remove(id, outsider).expect(404);
      await remove(id, outsider, { reason: REASON }, otherStoreId).expect(404);

      expect((await storedProofs()).length).toBe(1);
    });

    it.each([
      ['no reason', {}],
      ['a reason too short', { reason: ' a ' }],
      ['a reason too long', { reason: 'x'.repeat(501) }],
      ['a reason that is not text', { reason: 12 }],
    ])('refuses %s', async (_, body) => {
      const id = await attached();

      await remove(id, manager, body).expect(400);

      expect((await storedProofs()).length).toBe(1);
    });

    it('answers 404 the second time, and for an unknown proof', async () => {
      const id = await attached();
      await remove(id).expect(204);

      await remove(id).expect(404);
      await remove(UNKNOWN_ID).expect(404);
      await remove('not-a-uuid').expect(400);
      expect(
        await prisma.activityLog.count({ where: { action: 'PROOF_REMOVED' } }),
      ).toBe(1);
    });

    it('lets one of two parallel removals win', async () => {
      const id = await attached();

      const statuses = await Promise.all(
        [1, 2].map(() => remove(id).then((res) => res.status)),
      );

      expect(statuses.sort((a, b) => a - b)).toEqual([204, 404]);
      expect(
        await prisma.activityLog.count({ where: { action: 'PROOF_REMOVED' } }),
      ).toBe(1);
    });

    it('needs a session', async () => {
      const id = await attached();

      await api()
        .delete(`/api/v1/stores/${storeId}/proofs/${id}`)
        .send({ reason: REASON })
        .expect(401);
    });
  });
});
