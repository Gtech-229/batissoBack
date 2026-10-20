import type { INestApplication } from '@nestjs/common';
import { readFile, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { createTestApp } from './utils/app.js';
import { createMali, createStoreRecord } from './utils/countries.js';
import {
  clearPhotos,
  GIF,
  JPEG,
  PHOTO_DIR,
  PNG,
  storedPhotos,
} from './utils/photos.js';
import { resetDatabase } from './utils/reset-database.js';
import { signedInStaff, type MobileStaff } from './utils/staff.js';

type Status = 'PENDING' | 'VERIFIED' | 'SUSPENDED' | 'CLOSED';

const FIVE_MB = 5 * 1024 * 1024;
const PHOTO_ONLY =
  'Formulaire invalide : envoyez une seule photo, dans le champ « photo », sans autre champ';

describe('Identity photos (e2e)', () => {
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
    await clearPhotos();
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
    accountId = (
      await api()
        .post(`/api/v1/stores/${storeId}/accounts`)
        .set('Authorization', seller.authorization)
        .send({
          customer: {
            phone: '76 44 55 66',
            firstName: 'Fanta',
            lastName: 'Keita',
          },
          termsAccepted: true,
        })
        .expect(201)
    ).body.id as string;
  });

  afterAll(async () => {
    await clearPhotos();
    await app.close();
  });

  const api = () => request(app.getHttpServer());
  const putPhoto = (as = seller, account = accountId, store = storeId) =>
    api()
      .put(`/api/v1/stores/${store}/accounts/${account}/id-photo`)
      .set('Authorization', as.authorization);
  const upload = (
    content: Buffer,
    options: { as?: MobileStaff; filename?: string; contentType?: string } = {},
  ) =>
    putPhoto(options.as).attach('photo', content, {
      filename: options.filename ?? 'piece.jpg',
      contentType: options.contentType ?? 'image/jpeg',
    });
  const storedPath = async () =>
    (
      await prisma.account.findUniqueOrThrow({
        where: { id: accountId },
        select: { idPhotoPath: true },
      })
    ).idPhotoPath;
  const photoLogs = () =>
    prisma.activityLog.findMany({
      where: { action: 'ID_PHOTO_UPLOADED' },
      orderBy: { createdAt: 'asc' },
    });
  const expectPhotoError = (
    response: request.Response,
    reason: string,
  ): void => {
    expect(response.body).toMatchObject({
      statusCode: 400,
      details: [{ field: 'photo', errors: [reason] }],
    });
  };

  describe('PUT /stores/:storeId/accounts/:accountId/id-photo', () => {
    it.each([
      ['a seller', () => seller, JPEG, 'jpg'],
      ['a manager', () => manager, PNG, 'png'],
    ])(
      'lets %s upload a photo: private file, path stored, logged',
      async (_, who, content, extension) => {
        const actor = who();

        const response = await upload(content, {
          as: actor,
          contentType: extension === 'png' ? 'image/png' : 'image/jpeg',
        }).expect(200);

        expect(response.body).toMatchObject({
          id: accountId,
          hasIdPhoto: true,
        });
        // The answer never says where the file is.
        expect(JSON.stringify(response.body)).not.toContain(`.${extension}`);
        const name = await storedPath();
        expect(name).toMatch(new RegExp(`^[0-9a-f-]{36}\\.${extension}$`));
        expect(await storedPhotos()).toEqual([name]);
        expect(await readFile(join(PHOTO_DIR, name!))).toEqual(content);
        expect(await photoLogs()).toMatchObject([
          {
            storeId,
            userId: actor.userId,
            newValue: { accountId, replaced: false },
            device: actor.deviceId,
          },
        ]);
      },
    );

    it('replaces a photo: the old file is removed, the change logged', async () => {
      await upload(JPEG).expect(200);
      const first = await storedPath();

      await upload(PNG, { as: manager, contentType: 'image/png' }).expect(200);

      const second = await storedPath();
      expect(second).not.toBe(first);
      expect(await storedPhotos()).toEqual([second]);
      expect(
        (await photoLogs()).map((log) => log.newValue as { replaced: boolean }),
      ).toEqual([
        { accountId, replaced: false },
        { accountId, replaced: true },
      ]);
    });

    it('takes the type from the content, not from the name or Content-Type', async () => {
      await upload(PNG, { filename: 'photo.gif', contentType: 'image/gif' })
        .expect(200)
        .expect((r) => expect(r.body.hasIdPhoto).toBe(true));

      expect(await storedPath()).toMatch(/\.png$/);
    });

    it('accepts a photo of exactly 5 MB', async () => {
      const content = Buffer.concat([
        JPEG,
        Buffer.alloc(FIVE_MB - JPEG.length),
      ]);

      await upload(content).expect(200);
    });

    it.each([
      [
        'a text file sent as image/jpeg',
        () => upload(Buffer.from('not an image', 'utf8')),
        'La photo doit être une image JPEG ou PNG',
      ],
      [
        'a GIF',
        () => upload(GIF, { filename: 'piece.gif', contentType: 'image/gif' }),
        'La photo doit être une image JPEG ou PNG',
      ],
      [
        'an empty file',
        () => upload(Buffer.alloc(0)),
        'La photo doit être une image JPEG ou PNG',
      ],
      [
        'no file',
        () => putPhoto(),
        'La photo d’identité est requise, dans le champ « photo »',
      ],
      [
        'a JSON body',
        () => putPhoto().send({ photo: 'abc' }),
        'La photo d’identité est requise, dans le champ « photo »',
      ],
      [
        'a file in another field',
        () =>
          putPhoto().attach('picture', JPEG, {
            filename: 'piece.jpg',
            contentType: 'image/jpeg',
          }),
        PHOTO_ONLY,
      ],
      [
        'two files',
        () =>
          putPhoto()
            .attach('photo', JPEG, 'a.jpg')
            .attach('photo', JPEG, 'b.jpg'),
        PHOTO_ONLY,
      ],
      [
        'an extra text field',
        () => putPhoto().field('note', 'x').attach('photo', JPEG, 'a.jpg'),
        PHOTO_ONLY,
      ],
      [
        'a truncated multipart body (F-03)',
        () =>
          putPhoto()
            .set('Content-Type', 'multipart/form-data; boundary=cut')
            // A part that starts but never reaches its closing boundary.
            .send(
              [
                '--cut',
                'Content-Disposition: form-data; name="photo"; filename="a.jpg"',
                'Content-Type: image/jpeg',
                '',
                'jpeg bytes',
              ].join('\r\n'),
            ),
        PHOTO_ONLY,
      ],
      [
        'a photo over 5 MB',
        () =>
          upload(
            Buffer.concat([JPEG, Buffer.alloc(FIVE_MB - JPEG.length + 1)]),
          ),
        'La photo ne doit pas dépasser 5 Mo',
      ],
    ])(
      'refuses %s with a French 400 and keeps no file',
      async (_, send, reason) => {
        const response = await send().expect(400);

        expectPhotoError(response, reason);
        expect(await storedPhotos()).toEqual([]);
        expect(await storedPath()).toBeNull();
        expect(await photoLogs()).toEqual([]);
      },
    );

    it('keeps the current photo when a replacement is refused', async () => {
      await upload(JPEG).expect(200);
      const current = await storedPath();

      await upload(GIF).expect(400);

      expect(await storedPath()).toBe(current);
      expect(await storedPhotos()).toEqual([current]);
    });

    it('answers 404 for another store’s account and keeps no file', async () => {
      const otherStoreId = (
        await createStoreRecord(prisma, { status: 'VERIFIED' })
      ).id;
      const otherSeller = await signedInStaff(app, prisma, {
        phone: '+22376000002',
        store: { id: otherStoreId, role: 'SELLER' },
      });

      // The account exists, but in the first store: invisible from the other.
      const response = await putPhoto(otherSeller, accountId, otherStoreId)
        .attach('photo', JPEG, 'a.jpg')
        .expect(404);

      expect(response.body.message).toBe('Compte introuvable');
      expect(await storedPhotos()).toEqual([]);
      expect(await storedPath()).toBeNull();
    });

    it('answers 404 to a member of another store', async () => {
      const otherStoreId = (
        await createStoreRecord(prisma, { status: 'VERIFIED' })
      ).id;
      const outsider = await signedInStaff(app, prisma, {
        phone: '+22376000002',
        store: { id: otherStoreId, role: 'MANAGER' },
      });

      await upload(JPEG, { as: outsider }).expect(404);
      expect(await storedPhotos()).toEqual([]);
    });

    it.each([
      ['PENDING', 'en attente de vérification'],
      ['SUSPENDED', 'suspendue'],
      ['CLOSED', 'fermée'],
    ] as const)(
      'refuses a %s store with 409 STORE_NOT_VERIFIED and keeps no file',
      async (status: Status, label) => {
        await prisma.hardwareStore.update({
          where: { id: storeId },
          data: { status },
        });

        const response = await upload(JPEG).expect(409);

        expect(response.body).toMatchObject({
          error: 'STORE_NOT_VERIFIED',
          message: `Cette quincaillerie est ${label} : aucune photo d’identité ne peut y être enregistrée avant sa vérification`,
        });
        expect(await storedPhotos()).toEqual([]);
        expect(await storedPath()).toBeNull();
      },
    );

    it('answers 400 to malformed ids and 401 without a session', async () => {
      await putPhoto(seller, 'not-a-uuid')
        .attach('photo', JPEG, 'a.jpg')
        .expect(400)
        .expect((r) =>
          expect(r.body.message).toBe('Identifiant de compte invalide'),
        );
      await putPhoto(seller, accountId, 'not-a-uuid')
        .attach('photo', JPEG, 'a.jpg')
        .expect(400);
      await api()
        .put(`/api/v1/stores/${storeId}/accounts/${accountId}/id-photo`)
        .attach('photo', JPEG, 'a.jpg')
        .expect(401);
      expect(await storedPhotos()).toEqual([]);
    });
  });

  describe('GET /stores/:storeId/accounts/:accountId/id-photo', () => {
    // Collects the raw bytes, whatever the Content-Type.
    const binary = (
      res: NodeJS.ReadableStream,
      done: (error: Error | null, body: Buffer) => void,
    ) => {
      const chunks: Buffer[] = [];
      res.on('data', (chunk: Buffer) => chunks.push(chunk));
      res.on('end', () => done(null, Buffer.concat(chunks)));
    };
    const getPhoto = (as = seller, account = accountId, store = storeId) =>
      api()
        .get(`/api/v1/stores/${store}/accounts/${account}/id-photo`)
        .set('Authorization', as.authorization);
    const detail = () =>
      api()
        .get(`/api/v1/stores/${storeId}/accounts/${accountId}`)
        .set('Authorization', seller.authorization)
        .expect(200);

    it.each([
      ['a seller', () => seller, JPEG, 'image/jpeg'],
      ['a manager', () => manager, PNG, 'image/png'],
    ])(
      'gives %s the exact image, never cached, and logs nothing',
      async (_, who, content, contentType) => {
        await upload(content, { contentType }).expect(200);
        const logsBefore = await prisma.activityLog.count();

        const response = await getPhoto(who())
          .buffer(true)
          .parse(binary)
          .expect(200);

        expect(response.body).toEqual(content);
        expect(response.headers['content-type']).toBe(contentType);
        expect(response.headers['cache-control']).toBe('no-store');
        expect(response.headers['x-content-type-options']).toBe('nosniff');
        expect(response.headers['content-disposition']).toBe('inline');
        expect(await prisma.activityLog.count()).toBe(logsBefore);
      },
    );

    it('serves the replacement after a new upload', async () => {
      await upload(JPEG).expect(200);
      await upload(PNG, { contentType: 'image/png' }).expect(200);

      const response = await getPhoto().buffer(true).parse(binary).expect(200);

      expect(response.body).toEqual(PNG);
      expect(response.headers['content-type']).toBe('image/png');
    });

    it('answers 404 when the account has no photo', async () => {
      const response = await getPhoto().expect(404);

      expect(response.body.message).toBe(
        'Aucune photo d’identité pour ce compte',
      );
    });

    it('answers the same 404 when the file is missing on the server', async () => {
      await upload(JPEG).expect(200);
      await unlink(join(PHOTO_DIR, (await storedPath())!));

      const response = await getPhoto().expect(404);

      expect(response.body.message).toBe(
        'Aucune photo d’identité pour ce compte',
      );
    });

    it('answers 404 for another store’s account, even with a photo', async () => {
      await upload(JPEG).expect(200);
      const otherStoreId = (
        await createStoreRecord(prisma, { status: 'VERIFIED' })
      ).id;
      const otherManager = await signedInStaff(app, prisma, {
        phone: '+22376000002',
        store: { id: otherStoreId, role: 'MANAGER' },
      });

      const response = await getPhoto(
        otherManager,
        accountId,
        otherStoreId,
      ).expect(404);

      expect(response.body.message).toBe('Compte introuvable');
    });

    it('answers 404 to a member of another store', async () => {
      await upload(JPEG).expect(200);
      const otherStoreId = (
        await createStoreRecord(prisma, { status: 'VERIFIED' })
      ).id;
      const outsider = await signedInStaff(app, prisma, {
        phone: '+22376000002',
        store: { id: otherStoreId, role: 'MANAGER' },
      });

      await getPhoto(outsider).expect(404);
    });

    it('still serves the photo of a store that is no longer verified', async () => {
      await upload(JPEG).expect(200);
      await prisma.hardwareStore.update({
        where: { id: storeId },
        data: { status: 'SUSPENDED' },
      });

      await getPhoto().expect(200);
    });

    it('answers 400 to a malformed account id and 401 without a session', async () => {
      await getPhoto(seller, 'not-a-uuid').expect(400);
      await api()
        .get(`/api/v1/stores/${storeId}/accounts/${accountId}/id-photo`)
        .expect(401);
    });

    it('shows hasIdPhoto in the detail and the list (my-accounts.e2e-spec.ts checks /me/accounts has none)', async () => {
      expect((await detail()).body.hasIdPhoto).toBe(false);

      await upload(JPEG).expect(200);

      expect((await detail()).body.hasIdPhoto).toBe(true);
      const list = await api()
        .get(`/api/v1/stores/${storeId}/accounts`)
        .set('Authorization', seller.authorization)
        .expect(200);
      expect(list.body.items).toMatchObject([
        { id: accountId, hasIdPhoto: true },
      ]);
    });
  });
});
