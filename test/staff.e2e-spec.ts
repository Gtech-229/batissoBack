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

describe('Store staff (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let storeId: string;
  let manager: MobileStaff;

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
  });

  afterAll(async () => {
    await app.close();
  });

  const api = () => request(app.getHttpServer());
  const members = (as: MobileStaff, store = storeId) =>
    api()
      .get(`/api/v1/stores/${store}/members`)
      .set('Authorization', as.authorization);
  const addSeller = (body: Record<string, unknown>, as = manager) =>
    api()
      .post(`/api/v1/stores/${storeId}/sellers`)
      .set('Authorization', as.authorization)
      .send({
        phone: '76 11 22 33',
        firstName: 'Moussa',
        lastName: 'Traoré',
        ...body,
      });
  const setActive = (
    userId: string,
    action: 'deactivate' | 'reactivate',
    as = manager,
  ) =>
    api()
      .patch(`/api/v1/stores/${storeId}/sellers/${userId}/${action}`)
      .set('Authorization', as.authorization);
  const logs = () =>
    prisma.activityLog.findMany({ orderBy: { createdAt: 'asc' } });
  const setStoreStatus = (status: Status) =>
    prisma.hardwareStore.update({ where: { id: storeId }, data: { status } });

  describe('POST /stores/:storeId/sellers', () => {
    it('creates the user of a new phone (no PIN) and makes them a seller, logged', async () => {
      const response = await addSeller({}).expect(201);

      expect(response.body).toEqual({
        userId: expect.any(String),
        firstName: 'Moussa',
        lastName: 'Traoré',
        phone: '+22376112233',
        role: 'SELLER',
        active: true,
        since: expect.any(String),
      });
      const user = await prisma.user.findUniqueOrThrow({
        where: { phone: '+22376112233' },
      });
      expect(user.pinHash).toBeNull();
      expect(await logs()).toMatchObject([
        {
          storeId,
          userId: manager.userId,
          action: 'SELLER_ADDED',
          oldValue: null,
          newValue: {
            userId: user.id,
            firstName: 'Moussa',
            lastName: 'Traoré',
            phone: '+22376112233',
            role: 'SELLER',
          },
          device: manager.deviceId,
        },
      ]);
    });

    it('reuses an existing user and keeps their names', async () => {
      const existing = await createUser(prisma, {
        phone: '+22376112233',
        firstName: 'Aminata',
      });

      const response = await addSeller({ firstName: 'Autre' }).expect(201);

      expect(response.body).toMatchObject({
        userId: existing.id,
        firstName: 'Aminata',
        lastName: 'Diallo',
      });
      expect(await prisma.user.count()).toBe(2);
    });

    it.each([
      ['an active seller', 'SELLER'],
      ['a manager', 'MANAGER'],
    ] as const)(
      'refuses %s of the store with 409 ALREADY_MEMBER',
      async (_label, role) => {
        const user = await createUser(prisma, { phone: '+22376112233' });
        await prisma.storeMember.create({
          data: { userId: user.id, storeId, role },
        });

        const response = await addSeller({}).expect(409);

        expect(response.body).toMatchObject({
          error: 'ALREADY_MEMBER',
          message:
            'Ce numéro fait déjà partie de l’équipe de cette quincaillerie',
        });
        expect(await logs()).toEqual([]);
      },
    );

    it('refuses the manager adding their own phone', async () => {
      const response = await addSeller({ phone: manager.phone }).expect(409);

      expect(response.body.error).toBe('ALREADY_MEMBER');
    });

    it('reactivates a former seller with 200 and logs it', async () => {
      const user = await createUser(prisma, { phone: '+22376112233' });
      await prisma.storeMember.create({
        data: { userId: user.id, storeId, role: 'SELLER', active: false },
      });

      const response = await addSeller({}).expect(200);

      expect(response.body).toMatchObject({ userId: user.id, active: true });
      expect(await logs()).toMatchObject([
        {
          action: 'SELLER_REACTIVATED',
          oldValue: { userId: user.id, active: false },
          newValue: { userId: user.id, active: true },
        },
      ]);
    });

    it('refuses a phone of another country, in French', async () => {
      const response = await addSeller({ phone: '+225 07 00 00 00 00' }).expect(
        400,
      );

      expect(response.body.details).toEqual([
        {
          field: 'phone',
          errors: ['Ce numéro n’est pas un numéro valide du pays ML'],
        },
      ]);
    });

    it.each([
      ['PENDING', 'en attente de vérification'],
      ['SUSPENDED', 'suspendue'],
      ['CLOSED', 'fermée'],
    ] as const)(
      'refuses a %s store with 409 STORE_NOT_VERIFIED and changes nothing',
      async (status, label) => {
        await setStoreStatus(status);

        const response = await addSeller({}).expect(409);

        expect(response.body).toMatchObject({
          error: 'STORE_NOT_VERIFIED',
          message: `Cette quincaillerie est ${label} : son équipe ne peut être modifiée qu’une fois vérifiée`,
        });
        expect(await prisma.user.count()).toBe(1);
        expect(await logs()).toEqual([]);
      },
    );

    it('lets only one of two parallel adds of the same new phone through', async () => {
      const statuses = (await Promise.all([addSeller({}), addSeller({})]))
        .map((r) => r.status)
        .sort((a, b) => a - b);

      expect(statuses).toEqual([201, 409]);
      expect(
        await prisma.user.count({ where: { phone: '+22376112233' } }),
      ).toBe(1);
      expect(await prisma.storeMember.count({ where: { storeId } })).toBe(2);
      expect(await logs()).toHaveLength(1);
    });

    it.each([
      [{ firstName: '' }, 'firstName'],
      [{ lastName: undefined }, 'lastName'],
      [{ phone: 42 }, 'phone'],
      [{ role: 'MANAGER' }, 'role'],
    ])('validates %j in French', async (body, field) => {
      const response = await addSeller(body).expect(400);

      expect(
        response.body.details.map((d: { field: string }) => d.field),
      ).toEqual([field]);
    });
  });

  describe('deactivate and reactivate', () => {
    let seller: MobileStaff;

    beforeEach(async () => {
      seller = await signedInStaff(app, prisma, {
        phone: '+22376112233',
        store: { id: storeId, role: 'SELLER' },
      });
    });

    it('deactivates, then reactivates, each change logged once', async () => {
      const off = await setActive(seller.userId, 'deactivate').expect(200);
      expect(off.body).toMatchObject({ userId: seller.userId, active: false });

      const on = await setActive(seller.userId, 'reactivate').expect(200);
      expect(on.body.active).toBe(true);

      expect(await logs()).toMatchObject([
        {
          action: 'SELLER_DEACTIVATED',
          oldValue: { userId: seller.userId, active: true },
          newValue: { userId: seller.userId, active: false },
          userId: manager.userId,
          device: manager.deviceId,
        },
        { action: 'SELLER_REACTIVATED' },
      ]);
    });

    it('logs the seller id in lowercase when the URL has capitals (F-09)', async () => {
      await setActive(seller.userId.toUpperCase(), 'deactivate').expect(200);

      expect(await logs()).toMatchObject([
        {
          action: 'SELLER_DEACTIVATED',
          oldValue: { userId: seller.userId, active: true },
          newValue: { userId: seller.userId, active: false },
        },
      ]);
    });

    it('refuses repeating the same change with 409', async () => {
      await setActive(seller.userId, 'reactivate')
        .expect(409)
        .expect((r) => expect(r.body.error).toBe('ALREADY_ACTIVE'));
      await setActive(seller.userId, 'deactivate').expect(200);
      await setActive(seller.userId, 'deactivate')
        .expect(409)
        .expect((r) => expect(r.body.error).toBe('ALREADY_INACTIVE'));
      expect(await logs()).toHaveLength(1);
    });

    it('locks the deactivated seller out of the store at once, but keeps their account', async () => {
      // An active seller is a member, without the manager role.
      await members(seller)
        .expect(403)
        .expect((r) => expect(r.body.error).toBe('STORE_ROLE_REQUIRED'));

      await setActive(seller.userId, 'deactivate').expect(200);

      await members(seller)
        .expect(404)
        .expect((r) =>
          expect(r.body.message).toBe('Quincaillerie introuvable'),
        );
      await api()
        .get('/api/v1/me')
        .set('Authorization', seller.authorization)
        .expect(200);
    });

    it.each([
      ['a manager', () => manager.userId],
      ['an unknown user', () => '0192f0a4-7b1c-7c3e-9d2a-5e6f7a8b9c0d'],
    ])('answers 404 Vendeur introuvable for %s', async (_label, id) => {
      const response = await setActive(id(), 'deactivate').expect(404);

      expect(response.body.message).toBe('Vendeur introuvable');
    });

    it('refuses a malformed seller id in French', async () => {
      const response = await setActive('not-a-uuid', 'deactivate').expect(400);

      expect(response.body.message).toBe('Identifiant de vendeur invalide');
    });

    it('refuses changes in a store that is not verified', async () => {
      await setStoreStatus('SUSPENDED');

      await setActive(seller.userId, 'deactivate')
        .expect(409)
        .expect((r) => expect(r.body.error).toBe('STORE_NOT_VERIFIED'));
    });
  });

  describe('GET /stores/:storeId/members', () => {
    it('lists managers first, then sellers, inactive ones marked', async () => {
      await addSeller({}).expect(201);
      const second = await addSeller({
        phone: '76 44 55 66',
        firstName: 'Fanta',
        lastName: 'Keita',
      }).expect(201);
      await setActive(second.body.userId, 'deactivate').expect(200);

      const response = await members(manager).expect(200);

      expect(
        response.body.map(
          (m: { firstName: string; role: string; active: boolean }) => [
            m.firstName,
            m.role,
            m.active,
          ],
        ),
      ).toEqual([
        ['Awa', 'MANAGER', true],
        ['Moussa', 'SELLER', true],
        ['Fanta', 'SELLER', false],
      ]);
    });

    it('stays readable in any store status', async () => {
      await setStoreStatus('CLOSED');

      await members(manager).expect(200);
    });
  });

  describe('GET /stores/:storeId/activity', () => {
    const activity = (query = '', as = manager, store = storeId) =>
      api()
        .get(`/api/v1/stores/${store}/activity${query}`)
        .set('Authorization', as.authorization);

    it('lists this store’s entries newest first, with the author’s names', async () => {
      const added = await addSeller({}).expect(201);
      await setActive(added.body.userId, 'deactivate').expect(200);
      await setActive(added.body.userId, 'reactivate').expect(200);
      // An entry of another store, which must not show.
      const other = await createStoreRecord(prisma, { status: 'VERIFIED' });
      await prisma.activityLog.create({
        data: {
          storeId: other.id,
          userId: manager.userId,
          action: 'SELLER_ADDED',
        },
      });

      const response = await activity().expect(200);

      expect(response.body).toMatchObject({ total: 3, page: 1, pageSize: 20 });
      expect(
        response.body.items.map((e: { action: string }) => e.action),
      ).toEqual(['SELLER_REACTIVATED', 'SELLER_DEACTIVATED', 'SELLER_ADDED']);
      expect(response.body.items[0]).toEqual({
        id: expect.any(String),
        action: 'SELLER_REACTIVATED',
        author: {
          userId: manager.userId,
          firstName: 'Awa',
          lastName: 'Diallo',
        },
        oldValue: { userId: added.body.userId, active: false },
        newValue: { userId: added.body.userId, active: true },
        device: manager.deviceId,
        createdAt: expect.any(String),
      });
    });

    it('paginates, with the real total past the end', async () => {
      for (const [i, phone] of [
        '76 11 11 11',
        '76 22 22 22',
        '76 33 33 33',
      ].entries()) {
        await addSeller({ phone, firstName: `Vendeur ${i}` }).expect(201);
      }

      const page2 = await activity('?page=2&pageSize=2').expect(200);
      expect(page2.body).toMatchObject({ total: 3, page: 2, pageSize: 2 });
      expect(page2.body.items).toHaveLength(1);
      const past = await activity('?page=9&pageSize=2').expect(200);
      expect(past.body).toMatchObject({ items: [], total: 3 });
      await activity('?pageSize=101').expect(400);
    });

    it('is empty for a store with no activity yet', async () => {
      const response = await activity().expect(200);

      expect(response.body).toEqual({
        items: [],
        total: 0,
        page: 1,
        pageSize: 20,
      });
    });

    it('is for managers only, and only of their store', async () => {
      const seller = await signedInStaff(app, prisma, {
        phone: '+22376112233',
        store: { id: storeId, role: 'SELLER' },
      });
      await activity('', seller)
        .expect(403)
        .expect((r) => expect(r.body.error).toBe('STORE_ROLE_REQUIRED'));

      const other = await createStoreRecord(prisma, { status: 'VERIFIED' });
      await activity('', manager, other.id).expect(404);
    });
  });

  describe('isolation between stores', () => {
    it('answers 404 to a manager of another store, on every route', async () => {
      const other = await createStoreRecord(prisma, { status: 'VERIFIED' });
      const outsider = await signedInStaff(app, prisma, {
        phone: '+22376999999',
        store: { id: other.id, role: 'MANAGER' },
      });
      const seller = await createUser(prisma, { phone: '+22376112233' });
      await prisma.storeMember.create({
        data: { userId: seller.id, storeId, role: 'SELLER' },
      });

      // Built one at a time: supertest opens a server per request it creates.
      for (const call of [
        () => members(outsider),
        () => addSeller({ phone: '76 44 55 66' }, outsider),
        () => setActive(seller.id, 'deactivate', outsider),
      ]) {
        const response = await call().expect(404);
        expect(response.body.message).toBe('Quincaillerie introuvable');
      }
      expect(await logs()).toEqual([]);
    });

    it('answers 404 for an unknown store and 400 for a malformed id', async () => {
      await members(manager, '0192f0a4-7b1c-7c3e-9d2a-5e6f7a8b9c0d').expect(
        404,
      );
      const response = await members(manager, 'not-a-uuid').expect(400);
      expect(response.body.message).toBe(
        'Identifiant de quincaillerie invalide',
      );
    });

    it('needs a mobile session', async () => {
      await api().get(`/api/v1/stores/${storeId}/members`).expect(401);
    });
  });
});
