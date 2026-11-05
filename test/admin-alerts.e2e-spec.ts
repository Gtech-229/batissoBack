import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import type { Permission } from '../src/admin-auth/permissions.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { createAdmin } from './utils/admins.js';
import { accessCookieFor, createTestApp } from './utils/app.js';
import { createMali, createStoreRecord } from './utils/countries.js';
import { resetDatabase } from './utils/reset-database.js';
import { createUser } from './utils/users.js';

const UNKNOWN_ID = '0192f0a4-7b1c-7c3e-9d2a-5e6f7a8b9c0d';

describe('Admin alerts (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let storeId: string;
  let accountId: string;
  let goalId: string;

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
    const customer = await createUser(prisma, { phone: '+22376445566' });
    const account = await prisma.account.create({
      data: {
        number: 'C-000123',
        customerId: customer.id,
        storeId,
        currencyCode: 'XOF',
        termsAcceptedAt: new Date(),
        openedById: customer.id,
        goals: { create: { label: 'Non affecté', isSystem: true } },
      },
      include: { goals: true },
    });
    accountId = account.id;
    goalId = account.goals[0].id;
  });

  afterAll(async () => {
    await app.close();
  });

  const api = () => request(app.getHttpServer());
  async function signedIn(permissions: Permission[]) {
    const email = `a${Math.random().toString(36).slice(2, 8)}@batisso.test`;
    const admin = await createAdmin(prisma, { email, permissions });
    return { admin, cookie: await accessCookieFor(app, email) };
  }
  const alert = (
    type: 'ACCOUNT_BALANCE_GAP' | 'GOAL_BALANCE_GAP' | 'GOAL_SUM_GAP',
    overrides: {
      createdAt?: Date;
      resolvedAt?: Date;
      difference?: bigint;
    } = {},
  ) =>
    prisma.adminAlert.create({
      data: {
        type,
        storeId,
        accountId,
        goalId: type === 'GOAL_BALANCE_GAP' ? goalId : null,
        difference: overrides.difference ?? 300n,
        createdAt: overrides.createdAt,
        resolvedAt: overrides.resolvedAt,
      },
    });
  const list = (cookie: string, query = '') =>
    api().get(`/api/v1/admin/alerts${query}`).set('Cookie', cookie);
  const resolve = (cookie: string, id: string) =>
    api().patch(`/api/v1/admin/alerts/${id}/resolve`).set('Cookie', cookie);

  describe('GET /admin/alerts', () => {
    it('lists open alerts newest first, with the store, account, goal and gap', async () => {
      const older = await alert('GOAL_BALANCE_GAP', {
        createdAt: new Date('2026-11-04T02:00:00Z'),
        difference: -500n,
      });
      const newer = await alert('ACCOUNT_BALANCE_GAP', {
        createdAt: new Date('2026-11-05T02:00:00Z'),
      });
      await alert('GOAL_SUM_GAP', { resolvedAt: new Date() });
      const { cookie } = await signedIn(['alerts.read']);

      const response = await list(cookie).expect(200);

      expect(response.body).toMatchObject({ total: 2, page: 1, pageSize: 20 });
      expect(response.body.items).toEqual([
        {
          id: newer.id,
          type: 'ACCOUNT_BALANCE_GAP',
          store: { id: storeId, name: 'Quincaillerie du Carrefour' },
          account: { id: accountId, number: 'C-000123' },
          goal: null,
          order: null,
          difference: '300',
          createdAt: '2026-11-05T02:00:00.000Z',
          resolvedAt: null,
          resolvedBy: null,
        },
        expect.objectContaining({
          id: older.id,
          type: 'GOAL_BALANCE_GAP',
          goal: { id: goalId, label: 'Non affecté' },
          difference: '-500',
        }),
      ]);
    });

    it('filters by status and type', async () => {
      await alert('ACCOUNT_BALANCE_GAP');
      await alert('GOAL_SUM_GAP', { resolvedAt: new Date() });
      const { cookie } = await signedIn(['alerts.read']);

      const resolved = await list(cookie, '?status=resolved').expect(200);
      expect(resolved.body.items.map((a: { type: string }) => a.type)).toEqual([
        'GOAL_SUM_GAP',
      ]);
      const all = await list(cookie, '?status=all').expect(200);
      expect(all.body.total).toBe(2);
      const byType = await list(cookie, '?status=all&type=GOAL_SUM_GAP').expect(
        200,
      );
      expect(byType.body.total).toBe(1);
    });

    it('refuses a bad filter in French', async () => {
      const { cookie } = await signedIn(['alerts.read']);

      const response = await list(cookie, '?status=closed&type=OTHER').expect(
        400,
      );

      expect(response.body.details).toEqual(
        expect.arrayContaining([
          {
            field: 'status',
            errors: ['Le statut doit être open, resolved ou all'],
          },
          { field: 'type', errors: ['Type d’alerte inconnu'] },
        ]),
      );
    });

    it('refuses an admin without alerts.read (403), and no session (401)', async () => {
      const { cookie } = await signedIn(['alerts.manage', 'stores.read']);

      await list(cookie).expect(403);
      await api().get('/api/v1/admin/alerts').expect(401);
    });
  });

  describe('PATCH /admin/alerts/:id/resolve', () => {
    it('records who resolved it and when, once', async () => {
      const open = await alert('ACCOUNT_BALANCE_GAP');
      const { admin, cookie } = await signedIn(['alerts.manage']);

      const response = await resolve(cookie, open.id).expect(200);

      expect(response.body).toMatchObject({
        id: open.id,
        resolvedAt: expect.any(String),
        resolvedBy: {
          id: admin.id,
          firstName: admin.firstName,
          lastName: admin.lastName,
        },
      });
      const again = await resolve(cookie, open.id).expect(409);
      expect(again.body).toMatchObject({
        error: 'ALERT_ALREADY_RESOLVED',
        message: 'Cette alerte est déjà marquée comme traitée',
      });
    });

    it('lets only one of two parallel resolves through', async () => {
      const open = await alert('ACCOUNT_BALANCE_GAP');
      const { cookie } = await signedIn(['alerts.manage']);

      const responses = await Promise.all([
        resolve(cookie, open.id),
        resolve(cookie, open.id),
      ]);

      expect(responses.map((r) => r.status).sort((a, b) => a - b)).toEqual([
        200, 409,
      ]);
    });

    it('answers 404 for an unknown alert and 400 for a malformed id', async () => {
      const { cookie } = await signedIn(['alerts.manage']);

      const unknown = await resolve(cookie, UNKNOWN_ID).expect(404);
      expect(unknown.body).toMatchObject({ message: 'Alerte introuvable' });
      const bad = await resolve(cookie, 'not-a-uuid').expect(400);
      expect(bad.body).toMatchObject({
        message: 'Identifiant d’alerte invalide',
      });
    });

    it('refuses an admin without alerts.manage (403), and no session (401)', async () => {
      const open = await alert('ACCOUNT_BALANCE_GAP');
      const { cookie } = await signedIn(['alerts.read']);

      await resolve(cookie, open.id).expect(403);
      await api().patch(`/api/v1/admin/alerts/${open.id}/resolve`).expect(401);
      expect(
        (await prisma.adminAlert.findUniqueOrThrow({ where: { id: open.id } }))
          .resolvedAt,
      ).toBeNull();
    });
  });

  it('offers both permissions in the role editor, outside the Administrateur role', async () => {
    await createAdmin(prisma, {
      email: 'super@batisso.test',
      role: 'SUPER_ADMIN',
    });
    const superCookie = await accessCookieFor(app, 'super@batisso.test');

    const permissions = await api()
      .get('/api/v1/admin/permissions')
      .set('Cookie', superCookie)
      .expect(200);
    expect(JSON.stringify(permissions.body)).toContain('alerts.read');
    expect(JSON.stringify(permissions.body)).toContain('alerts.manage');

    const defaultAdmin = await createAdmin(prisma, {
      email: 'admin@batisso.test',
    });
    const role = await prisma.accessRole.findUniqueOrThrow({
      where: { id: defaultAdmin.roleId! },
    });
    expect(role.name).toBe('Administrateur');
    expect(role.permissions).not.toContain('alerts.read');
    expect(role.permissions).not.toContain('alerts.manage');
  });
});
