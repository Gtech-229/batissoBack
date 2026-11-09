import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import type { Permission } from '../src/admin-auth/permissions.js';
import { createAdmin } from './utils/admins.js';
import { accessCookieFor, createTestApp } from './utils/app.js';
import { createMali, createStoreRecord } from './utils/countries.js';
import {
  clearDocuments,
  GIF,
  JPEG,
  PNG,
  storedDocuments,
} from './utils/photos.js';
import { resetDatabase } from './utils/reset-database.js';
import { signedInStaff, type MobileStaff } from './utils/staff.js';

type Kind = 'identity' | 'trade-register';

const FIVE_MB = 5 * 1024 * 1024;
const PHOTO_ONLY =
  'Formulaire invalide : envoyez une seule photo, dans le champ « photo », sans autre champ';

describe('Store registration documents (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let manager: MobileStaff;
  let storeId: string;

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
  });

  beforeEach(async () => {
    await resetDatabase(prisma);
    await clearDocuments();
    await createMali(prisma);
    manager = await signedInStaff(app, prisma, {
      phone: '+22376123401',
      firstName: 'Ibrahim',
    });
    storeId = (
      await api()
        .post('/api/v1/stores')
        .set('Authorization', manager.authorization)
        .send({
          name: 'Quincaillerie Sanogo',
          address: 'Rue 7, Badalabougou',
          city: 'Bamako',
          phone: '20 22 11 11',
          tradeRegister: 'MA.BKO.2026.B.9876',
          settings: {
            maxBalance: '3000000',
            validationThreshold: '250000',
            minDeposit: '1000',
          },
          requestedPlan: 'PRO',
        })
        .expect(201)
    ).body.id as string;
  });

  afterAll(async () => {
    await clearDocuments();
    await app.close();
  });

  const api = () => request(app.getHttpServer());
  const putDocument = (kind: Kind, as = manager, store = storeId) =>
    api()
      .put(`/api/v1/stores/${store}/documents/${kind}`)
      .set('Authorization', as.authorization);
  const upload = (kind: Kind, content: Buffer = JPEG, as = manager) =>
    putDocument(kind, as).attach('photo', content, {
      filename: 'document.jpg',
      contentType: 'image/jpeg',
    });
  const paths = () =>
    prisma.hardwareStore.findUniqueOrThrow({
      where: { id: storeId },
      select: { managerIdPhotoPath: true, tradeRegisterPhotoPath: true },
    });

  describe('PUT /stores/:storeId/documents/identity and /trade-register', () => {
    it('stores each photo privately and answers which documents are present', async () => {
      const first = await upload('identity').expect(200);
      expect(first.body).toEqual({ identity: true, tradeRegister: false });

      const second = await upload('trade-register', PNG).expect(200);
      expect(second.body).toEqual({ identity: true, tradeRegister: true });

      const { managerIdPhotoPath, tradeRegisterPhotoPath } = await paths();
      expect(managerIdPhotoPath).toMatch(/\.jpg$/);
      expect(tradeRegisterPhotoPath).toMatch(/\.png$/);
      expect(await storedDocuments()).toEqual(
        [managerIdPhotoPath!, tradeRegisterPhotoPath!].sort((a, b) =>
          a < b ? -1 : 1,
        ),
      );
      // Never a file name in an answer.
      for (const response of [first, second]) {
        expect(JSON.stringify(response.body)).not.toMatch(/\.(jpg|png)/);
      }
    });

    it('replaces a photo and keeps only the new file', async () => {
      await upload('identity').expect(200);
      const before = (await paths()).managerIdPhotoPath;

      await upload('identity', PNG).expect(200);

      const after = (await paths()).managerIdPhotoPath;
      expect(after).not.toBe(before);
      expect(after).toMatch(/\.png$/);
      expect(await storedDocuments()).toEqual([after]);
    });

    it('refuses a seller of the store with 403 and stores nothing', async () => {
      const seller = await signedInStaff(app, prisma, {
        phone: '+22376451278',
        store: { id: storeId, role: 'SELLER' },
      });

      const response = await upload('identity', JPEG, seller).expect(403);

      expect(response.body).toMatchObject({ error: 'STORE_ROLE_REQUIRED' });
      expect(await storedDocuments()).toEqual([]);
    });

    it('answers 404 to a user who is not a member of the store', async () => {
      const stranger = await signedInStaff(app, prisma, {
        phone: '+22376451278',
      });

      await upload('trade-register', JPEG, stranger).expect(404);
      expect(await storedDocuments()).toEqual([]);
    });

    it('refuses a request without a session (401)', async () => {
      await api()
        .put(`/api/v1/stores/${storeId}/documents/identity`)
        .attach('photo', JPEG, 'a.jpg')
        .expect(401);
    });

    it.each([
      ['VERIFIED', 'vérifiée'],
      ['SUSPENDED', 'suspendue'],
      ['CLOSED', 'fermée'],
    ] as const)(
      'refuses a %s store with 409 STORE_NOT_PENDING and keeps no file',
      async (status, label) => {
        await upload('identity').expect(200);
        const kept = (await paths()).managerIdPhotoPath;
        await prisma.hardwareStore.update({
          where: { id: storeId },
          data: { status },
        });

        const response = await upload('identity', PNG).expect(409);

        expect(response.body).toMatchObject({
          error: 'STORE_NOT_PENDING',
          message: `Cette quincaillerie est ${label} : ses documents ne peuvent être envoyés qu’avant sa vérification`,
        });
        expect((await paths()).managerIdPhotoPath).toBe(kept);
        expect(await storedDocuments()).toEqual([kept]);
      },
    );

    it.each([
      [
        'no file',
        () => putDocument('identity').field('other', 'x'),
        PHOTO_ONLY,
      ],
      [
        'an empty form',
        () => putDocument('identity').type('form').send({}),
        'La photo du document est requise, dans le champ « photo »',
      ],
      [
        'a GIF',
        () => upload('identity', GIF),
        'La photo doit être une image JPEG ou PNG',
      ],
      [
        'a text file named .jpg',
        () => upload('identity', Buffer.from('not an image')),
        'La photo doit être une image JPEG ou PNG',
      ],
      [
        'two files',
        () =>
          putDocument('identity')
            .attach('photo', JPEG, 'a.jpg')
            .attach('photo', JPEG, 'b.jpg'),
        PHOTO_ONLY,
      ],
      [
        'a photo over 5 MB',
        () =>
          upload(
            'trade-register',
            Buffer.concat([JPEG, Buffer.alloc(FIVE_MB - JPEG.length + 1)]),
          ),
        'La photo ne doit pas dépasser 5 Mo',
      ],
    ])('refuses %s with a French 400', async (_, send, message) => {
      const response = await send().expect(400);

      expect(response.body.details).toEqual([
        { field: 'photo', errors: [message] },
      ]);
      expect(await paths()).toEqual({
        managerIdPhotoPath: null,
        tradeRegisterPhotoPath: null,
      });
      expect(await storedDocuments()).toEqual([]);
    });

    it('accepts a photo of exactly 5 MB', async () => {
      await upload(
        'identity',
        Buffer.concat([JPEG, Buffer.alloc(FIVE_MB - JPEG.length)]),
      ).expect(200);
    });
  });

  async function signedInAdmin(permissions: Permission[]) {
    const email = `a${Math.random().toString(36).slice(2, 8)}@batisso.test`;
    await createAdmin(prisma, { email, permissions });
    return accessCookieFor(app, email);
  }

  describe('GET /admin/stores/:id (21b fields)', () => {
    it('shows the requested plan, the self-registration and which documents are present', async () => {
      const cookie = await signedInAdmin(['stores.read']);
      await upload('trade-register').expect(200);

      const response = await api()
        .get(`/api/v1/admin/stores/${storeId}`)
        .set('Cookie', cookie)
        .expect(200);

      expect(response.body).toMatchObject({
        status: 'PENDING',
        requestedPlan: 'PRO',
        selfRegistered: true,
        documents: { identity: false, tradeRegister: true },
        managers: [expect.objectContaining({ userId: manager.userId })],
        subscriptionState: 'NONE',
      });
      expect(JSON.stringify(response.body)).not.toMatch(/\.(jpg|png)/);
    });

    it('shows an admin-registered store as not self-registered, with no plan', async () => {
      const cookie = await signedInAdmin(['stores.read']);
      const other = await createStoreRecord(prisma);

      const response = await api()
        .get(`/api/v1/admin/stores/${other.id}`)
        .set('Cookie', cookie)
        .expect(200);

      expect(response.body).toMatchObject({
        requestedPlan: null,
        selfRegistered: false,
        documents: { identity: false, tradeRegister: false },
      });
    });
  });

  describe('GET /admin/stores/:id/documents/identity and /trade-register', () => {
    const read = (kind: Kind, cookie: string, id = storeId) =>
      api()
        .get(`/api/v1/admin/stores/${id}/documents/${kind}`)
        .set('Cookie', cookie);

    it('returns each photo with its type, never cached', async () => {
      const cookie = await signedInAdmin(['stores.read']);
      await upload('identity', JPEG).expect(200);
      await upload('trade-register', PNG).expect(200);

      const identity = await read('identity', cookie)
        .buffer(true)
        .parse((res, done) => {
          const chunks: Buffer[] = [];
          res.on('data', (c: Buffer) => chunks.push(c));
          res.on('end', () => done(null, Buffer.concat(chunks)));
        })
        .expect(200);
      expect(identity.headers['content-type']).toBe('image/jpeg');
      expect(identity.headers['cache-control']).toBe('no-store');
      expect(identity.headers['x-content-type-options']).toBe('nosniff');
      expect(Buffer.compare(identity.body as Buffer, JPEG)).toBe(0);

      const tradeRegister = await read('trade-register', cookie).expect(200);
      expect(tradeRegister.headers['content-type']).toBe('image/png');
    });

    it('answers 404 for a document not sent yet', async () => {
      const cookie = await signedInAdmin(['stores.read']);

      const response = await read('identity', cookie).expect(404);

      expect(response.body).toMatchObject({
        message: 'Ce document n’a pas été envoyé',
      });
    });

    it('answers 404 when the file is missing on the server', async () => {
      const cookie = await signedInAdmin(['stores.read']);
      await upload('identity').expect(200);
      await clearDocuments();

      await read('identity', cookie).expect(404);
    });

    it('answers 404 for an unknown store and 400 for a malformed id', async () => {
      const cookie = await signedInAdmin(['stores.read']);

      await read(
        'identity',
        cookie,
        '0192f0a4-7b1c-7c3e-9d2a-5e6f7a8b9c0d',
      ).expect(404);
      await read('identity', cookie, 'not-a-uuid').expect(400);
    });

    it('refuses an admin without stores.read (403), and no session (401)', async () => {
      await upload('identity').expect(200);
      const cookie = await signedInAdmin(['countries.read']);

      await read('identity', cookie).expect(403);
      await api()
        .get(`/api/v1/admin/stores/${storeId}/documents/identity`)
        .expect(401);
    });

    it('is not reachable with a mobile session', async () => {
      await upload('identity').expect(200);

      await api()
        .get(`/api/v1/admin/stores/${storeId}/documents/identity`)
        .set('Authorization', manager.authorization)
        .expect(401);
    });
  });

  describe('PATCH /admin/stores/:id/verify (21b rule)', () => {
    const verify = (cookie: string, id = storeId) =>
      api().patch(`/api/v1/admin/stores/${id}/verify`).set('Cookie', cookie);
    const status = async (id = storeId) =>
      (
        await prisma.hardwareStore.findUniqueOrThrow({
          where: { id },
          select: { status: true },
        })
      ).status;

    it.each([
      [[], 'la pièce d’identité du gérant et le registre du commerce'],
      [['identity'], 'le registre du commerce'],
      [['trade-register'], 'la pièce d’identité du gérant'],
    ] as [Kind[], string][])(
      'refuses a self-registered store with %j sent: 409 STORE_DOCUMENTS_MISSING',
      async (sent, missing) => {
        const cookie = await signedInAdmin(['stores.read', 'stores.manage']);
        for (const kind of sent) {
          await upload(kind).expect(200);
        }

        const response = await verify(cookie).expect(409);

        expect(response.body).toMatchObject({
          error: 'STORE_DOCUMENTS_MISSING',
          message: `Impossible de vérifier cette quincaillerie : il manque ${missing}`,
        });
        expect(await status()).toBe('PENDING');
      },
    );

    it('verifies a self-registered store once both documents are sent; uploads are then refused', async () => {
      const cookie = await signedInAdmin(['stores.read', 'stores.manage']);
      await upload('identity').expect(200);
      await upload('trade-register').expect(200);

      const response = await verify(cookie).expect(200);

      expect(response.body).toMatchObject({
        status: 'VERIFIED',
        documents: { identity: true, tradeRegister: true },
      });
      await upload('identity', PNG).expect(409);
    });

    it('verifies when the last document arrives just before the refusal is explained (F-55)', async () => {
      const cookie = await signedInAdmin(['stores.read', 'stores.manage']);
      await upload('identity').expect(200);
      await upload('trade-register').expect(200);
      // The first verify UPDATE misses, as when the last upload commits right
      // after it: the re-read then finds both documents.
      const update = vi
        .spyOn(prisma.hardwareStore, 'updateMany')
        .mockResolvedValueOnce({ count: 0 });

      try {
        const response = await verify(cookie).expect(200);

        expect(response.body).toMatchObject({ status: 'VERIFIED' });
        expect(update).toHaveBeenCalledTimes(2);
      } finally {
        update.mockRestore();
      }
      expect(await status()).toBe('VERIFIED');
    });

    it('verifies an admin-registered store without documents, as before', async () => {
      const cookie = await signedInAdmin(['stores.read', 'stores.manage']);
      const other = await createStoreRecord(prisma);

      await verify(cookie, other.id).expect(200);

      expect(await status(other.id)).toBe('VERIFIED');
    });

    it('keeps INVALID_STATUS_TRANSITION for a store that is not PENDING', async () => {
      const cookie = await signedInAdmin(['stores.read', 'stores.manage']);
      await prisma.hardwareStore.update({
        where: { id: storeId },
        data: { status: 'CLOSED' },
      });

      const response = await verify(cookie).expect(409);

      expect(response.body).toMatchObject({
        error: 'INVALID_STATUS_TRANSITION',
      });
    });
  });
});
