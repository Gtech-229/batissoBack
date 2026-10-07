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

describe('Stores: lifecycle (e2e)', () => {
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

  const act = (id: string, action: Action, reason?: string) =>
    request(app.getHttpServer())
      .patch(`/api/v1/admin/stores/${id}/${action}`)
      .set('Cookie', cookie)
      .send(reason === undefined ? {} : { reason });

  it.each<[Action, Status, Status, string | undefined]>([
    ['verify', 'PENDING', 'VERIFIED', undefined],
    ['suspend', 'VERIFIED', 'SUSPENDED', 'Registre du commerce expiré'],
    ['reactivate', 'SUSPENDED', 'VERIFIED', undefined],
    ['close', 'PENDING', 'CLOSED', 'Dossier abandonné'],
    ['close', 'VERIFIED', 'CLOSED', 'Fermeture annoncée'],
    ['close', 'SUSPENDED', 'CLOSED', 'Fermeture définitive'],
  ])('%s: %s -> %s', async (action, from, to, reason) => {
    const store = await createStoreRecord(prisma, { status: from });

    const response = await act(store.id, action, reason).expect(200);

    expect(response.body.status).toBe(to);
    expect(response.body.statusReason).toBe(reason ?? null);
    const stored = await prisma.hardwareStore.findUniqueOrThrow({
      where: { id: store.id },
    });
    expect(stored.statusChangedById).toBe(adminId);
    expect(stored.statusChangedAt).not.toBeNull();
  });

  it('verify records the verification date', async () => {
    const store = await createStoreRecord(prisma, { status: 'PENDING' });

    const response = await act(store.id, 'verify').expect(200);

    expect(Date.parse(response.body.verifiedAt)).not.toBeNaN();
  });

  it('reactivate clears the suspension reason', async () => {
    const store = await createStoreRecord(prisma, { status: 'VERIFIED' });
    await act(store.id, 'suspend', 'Contrôle en cours').expect(200);

    const response = await act(store.id, 'reactivate').expect(200);

    expect(response.body.statusReason).toBeNull();
  });

  it.each<[Action, Status, string]>([
    ['verify', 'VERIFIED', 'Impossible de vérifier une quincaillerie vérifiée'],
    [
      'suspend',
      'PENDING',
      'Impossible de suspendre une quincaillerie en attente de vérification',
    ],
    [
      'reactivate',
      'VERIFIED',
      'Impossible de réactiver une quincaillerie vérifiée',
    ],
    ['close', 'CLOSED', 'Impossible de fermer une quincaillerie fermée'],
    ['verify', 'CLOSED', 'Impossible de vérifier une quincaillerie fermée'],
  ])('refuses %s from %s', async (action, from, message) => {
    const store = await createStoreRecord(prisma, { status: from });

    const response = await act(store.id, action, 'Un motif valable').expect(
      409,
    );

    expect(response.body).toMatchObject({
      error: 'INVALID_STATUS_TRANSITION',
      message,
    });
    const stored = await prisma.hardwareStore.findUniqueOrThrow({
      where: { id: store.id },
    });
    expect(stored.status).toBe(from);
  });

  it.each<[Action, string | undefined]>([
    ['suspend', undefined],
    ['close', undefined],
    ['suspend', '  '],
    ['close', 'ok'],
  ])(
    '%s requires a reason of 3 to 500 characters (got %j)',
    async (action, reason) => {
      const store = await createStoreRecord(prisma, { status: 'VERIFIED' });

      const response = await act(store.id, action, reason).expect(400);

      expect(response.body.details[0].field).toBe('reason');
    },
  );

  it('ignores a body on verify: no reason is stored', async () => {
    const store = await createStoreRecord(prisma, { status: 'PENDING' });

    const response = await act(store.id, 'verify', 'Inutile').expect(200);

    // verify declares no body, so Nest never reads it.
    expect(response.body.statusReason).toBeNull();
  });

  it('lets only one of two concurrent identical changes through', async () => {
    for (const [action, from, reason] of [
      ['verify', 'PENDING', undefined],
      ['close', 'VERIFIED', 'Fermeture'],
    ] as const) {
      const store = await createStoreRecord(prisma, { status: from });

      const responses = await Promise.all([
        act(store.id, action, reason),
        act(store.id, action, reason),
      ]);

      expect(responses.map((r) => r.status).sort((a, b) => a - b)).toEqual([
        200, 409,
      ]);
    }
  });

  it('answers 404 for an unknown store', async () => {
    await act('0192f0a4-7b1c-7c3e-9d2a-5e6f7a8b9c0d', 'verify').expect(404);
  });

  it('a closed store stays readable', async () => {
    const store = await createStoreRecord(prisma, { status: 'VERIFIED' });
    await act(store.id, 'close', 'Fermeture annoncée').expect(200);

    const response = await request(app.getHttpServer())
      .get(`/api/v1/admin/stores/${store.id}`)
      .set('Cookie', cookie)
      .expect(200);

    expect(response.body).toMatchObject({
      status: 'CLOSED',
      statusReason: 'Fermeture annoncée',
    });
  });
});
