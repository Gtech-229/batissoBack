import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { createAdmin } from './utils/admins.js';
import { accessCookieFor, createTestApp } from './utils/app.js';
import { createMali, createStoreRecord } from './utils/countries.js';
import { resetDatabase } from './utils/reset-database.js';

type Action = 'verify' | 'suspend' | 'reactivate' | 'close';
type Status = 'PENDING' | 'VERIFIED' | 'SUSPENDED' | 'CLOSED';

const UNKNOWN_ID = '0192f0a4-7b1c-7c3e-9d2a-5e6f7a8b9c0d';
const REASON = 'Registre du commerce expiré';

/** Each action: a status it applies to, and one it refuses. */
const CASES: [Action, Status, Status, Status, string | undefined][] = [
  ['verify', 'PENDING', 'VERIFIED', 'VERIFIED', undefined],
  ['suspend', 'VERIFIED', 'SUSPENDED', 'PENDING', REASON],
  ['reactivate', 'SUSPENDED', 'VERIFIED', 'VERIFIED', undefined],
  ['close', 'VERIFIED', 'CLOSED', 'CLOSED', REASON],
];

describe('Stores: group actions (e2e)', () => {
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
    await createMali(prisma);
  });

  afterAll(async () => {
    await app.close();
  });

  const api = () => request(app.getHttpServer());
  const bulk = (action: Action, body: object, sessionCookie = cookie) =>
    api()
      .post(`/api/v1/admin/stores/bulk/${action}`)
      .set('Cookie', sessionCookie)
      .send(body);
  const single = (id: string, action: Action, reason?: string) =>
    api()
      .patch(`/api/v1/admin/stores/${id}/${action}`)
      .set('Cookie', cookie)
      .send(reason === undefined ? {} : { reason });
  const reload = (id: string) =>
    prisma.hardwareStore.findUniqueOrThrow({ where: { id } });

  /** A store registered from the app (21b), with the given photos. */
  async function selfRegisteredStore(photos: {
    identity: boolean;
    tradeRegister: boolean;
  }) {
    const store = await createStoreRecord(prisma, { name: 'Inscrite seule' });
    const user = await prisma.user.create({
      data: {
        phone: `+2237${Math.floor(Math.random() * 1e7)
          .toString()
          .padStart(7, '0')}`,
        firstName: 'Awa',
        lastName: 'Diallo',
      },
    });
    return prisma.hardwareStore.update({
      where: { id: store.id },
      data: {
        registeredById: user.id,
        managerIdPhotoPath: photos.identity ? 'identity.jpg' : null,
        tradeRegisterPhotoPath: photos.tradeRegister
          ? 'trade-register.jpg'
          : null,
      },
    });
  }

  describe.each(CASES)(
    'POST /admin/stores/bulk/%s',
    (action, from, to, wrong, reason) => {
      it('applies to each store on its own, with the single action’s results', async () => {
        const ok = await createStoreRecord(prisma, { status: from });
        const refused = await createStoreRecord(prisma, { status: wrong });
        // The single route's answer for the refused store, before anything changes.
        const singleRefusal = (await single(refused.id, action, reason)).body;
        const singleUnknown = (await single(UNKNOWN_ID, action, reason)).body;

        const response = await bulk(action, {
          ids: [ok.id, refused.id, UNKNOWN_ID, ok.id, ok.id.toUpperCase()],
          ...(reason && { reason }),
        }).expect(200);

        expect(response.body).toEqual({
          results: [
            { id: ok.id, ok: true },
            {
              id: refused.id,
              ok: false,
              error: {
                code: singleRefusal.error,
                message: singleRefusal.message,
              },
            },
            {
              id: UNKNOWN_ID,
              ok: false,
              error: {
                code: singleUnknown.error,
                message: singleUnknown.message,
              },
            },
          ],
        });
        expect(singleRefusal.error).toBe('INVALID_STATUS_TRANSITION');
        expect(singleUnknown).toMatchObject({
          error: 'NOT_FOUND',
          message: 'Quincaillerie introuvable',
        });

        const changed = await reload(ok.id);
        expect(changed).toMatchObject({
          status: to,
          statusChangedById: adminId,
          statusReason: reason ?? null,
        });
        expect(changed.statusChangedAt).toBeInstanceOf(Date);
        expect((await reload(refused.id)).status).toBe(wrong);
      });
    },
  );

  describe('verify and documents', () => {
    it('accepts exactly what single verify accepts', async () => {
      const adminRegistered = await createStoreRecord(prisma);
      const complete = await selfRegisteredStore({
        identity: true,
        tradeRegister: true,
      });
      const missing = await selfRegisteredStore({
        identity: true,
        tradeRegister: false,
      });
      const singleMissing = (await single(missing.id, 'verify')).body;

      const response = await bulk('verify', {
        ids: [adminRegistered.id, complete.id, missing.id],
      }).expect(200);

      expect(response.body.results).toEqual([
        { id: adminRegistered.id, ok: true },
        { id: complete.id, ok: true },
        {
          id: missing.id,
          ok: false,
          error: {
            code: 'STORE_DOCUMENTS_MISSING',
            message: singleMissing.message,
          },
        },
      ]);
      expect((await reload(adminRegistered.id)).verifiedAt).toBeInstanceOf(
        Date,
      );
      expect((await reload(missing.id)).status).toBe('PENDING');
    });
  });

  it('reactivate clears the suspension reason', async () => {
    const store = await createStoreRecord(prisma, { status: 'VERIFIED' });
    await bulk('suspend', { ids: [store.id], reason: REASON }).expect(200);
    expect((await reload(store.id)).statusReason).toBe(REASON);

    await bulk('reactivate', { ids: [store.id] }).expect(200);

    expect(await reload(store.id)).toMatchObject({
      status: 'VERIFIED',
      statusReason: null,
    });
  });

  describe('validation', () => {
    /** 101 ids, the store's first. */
    const tooMany = (id: string) => [
      id,
      ...Array.from(
        { length: 100 },
        (_, i) => `0192f0a4-7b1c-7c3e-9d2a-${i.toString().padStart(12, '0')}`,
      ),
    ];

    // Each body names the store (when it has ids): a 400 must leave it alone.
    it.each<[string, Action, (id: string) => object, string, string]>([
      [
        'an empty list',
        'verify',
        () => ({ ids: [] }),
        'ids',
        'Choisissez de 1 à 100 quincailleries',
      ],
      [
        '101 ids',
        'suspend',
        (id) => ({ ids: tooMany(id), reason: REASON }),
        'ids',
        'Choisissez de 1 à 100 quincailleries',
      ],
      [
        'an id that is not a UUID',
        'suspend',
        (id) => ({ ids: [id, 'abc'], reason: REASON }),
        'ids',
        'Chaque identifiant de quincaillerie doit être un UUID',
      ],
      [
        'a missing reason',
        'suspend',
        (id) => ({ ids: [id] }),
        'reason',
        'Le motif est requis',
      ],
      [
        'a reason too short once trimmed',
        'close',
        (id) => ({ ids: [id], reason: '  ab  ' }),
        'reason',
        'Le motif doit contenir 3 à 500 caractères',
      ],
      [
        'an unknown field',
        'suspend',
        (id) => ({ ids: [id], reason: REASON, note: 'x' }),
        'note',
        "Ce champ n'est pas autorisé",
      ],
    ])(
      'refuses %s and changes nothing',
      async (_case, action, body, field, message) => {
        const store = await createStoreRecord(prisma, { status: 'VERIFIED' });

        const response = await bulk(action, body(store.id)).expect(400);

        expect(response.body.details).toContainEqual({
          field,
          errors: expect.arrayContaining([message]),
        });
        expect((await reload(store.id)).status).toBe('VERIFIED');
      },
    );
  });

  describe('permissions', () => {
    it('requires stores.manage', async () => {
      await createAdmin(prisma, {
        email: 'reader@batisso.test',
        permissions: ['stores.read'],
      });
      const readerCookie = await accessCookieFor(app, 'reader@batisso.test');
      const store = await createStoreRecord(prisma);

      await bulk('verify', { ids: [store.id] }, readerCookie).expect(403);
      expect((await reload(store.id)).status).toBe('PENDING');
    });

    it('requires a signed-in admin', async () => {
      await api()
        .post('/api/v1/admin/stores/bulk/verify')
        .send({ ids: [UNKNOWN_ID] })
        .expect(401);
    });
  });
});
