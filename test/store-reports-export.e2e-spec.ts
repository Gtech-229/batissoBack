import type { INestApplication } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { readSheet } from 'read-excel-file/node';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { createTestApp } from './utils/app.js';
import { createMali, createStoreRecord } from './utils/countries.js';
import { resetDatabase } from './utils/reset-database.js';
import { signedInStaff, type MobileStaff } from './utils/staff.js';

const DAY = { from: '2026-10-10', to: '2026-10-10' };
const IN_DAY = new Date('2026-10-10T12:00:00.000Z');
const XLSX =
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

describe('Report exports (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let storeId: string;
  let manager: MobileStaff;
  let seller: MobileStaff;
  let outsider: MobileStaff;
  let accountId: string;
  let goalId: string;
  let sequence = 0;

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
  });

  beforeEach(async () => {
    await resetDatabase(prisma);
    await createMali(prisma);
    storeId = (await createStoreRecord(prisma, { status: 'VERIFIED' })).id;
    const otherStoreId = (
      await createStoreRecord(prisma, { status: 'VERIFIED' })
    ).id;
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
    const customer = await signedInStaff(app, prisma, {
      phone: '+22376445566',
      firstName: 'Fanta',
    });
    const opened = await api()
      .post(`/api/v1/stores/${storeId}/accounts`)
      .set('Authorization', seller.authorization)
      .send({
        customer: { phone: customer.phone, firstName: 'F', lastName: 'K' },
        termsAccepted: true,
      })
      .expect(201);
    accountId = (opened.body as { id: string }).id;
    goalId = (await prisma.goal.findFirstOrThrow({ where: { accountId } })).id;
  });

  afterAll(async () => {
    await app.close();
  });

  const api = () => request(app.getHttpServer());

  /** Collects a binary answer, whatever its type. */
  const binary = (
    res: request.Response,
    callback: (error: Error | null, body: Buffer) => void,
  ) => {
    const chunks: Buffer[] = [];
    res.on('data', (chunk: Buffer) => chunks.push(chunk));
    res.on('end', () => callback(null, Buffer.concat(chunks)));
  };

  const download = (
    path: string,
    query: Record<string, unknown>,
    as: MobileStaff = manager,
  ) =>
    api()
      .get(`/api/v1/stores/${storeId}/reports/${path}/export`)
      .set('Authorization', as.authorization)
      .query(query)
      .buffer(true)
      .parse(binary as never);

  const deposit = (amount: bigint) => {
    sequence += 1;
    return prisma.operation.create({
      data: {
        reference: `D-${String(sequence).padStart(5, '0')}`,
        accountId,
        storeId,
        goalId,
        type: 'DEPOSIT',
        amount,
        direction: 'CREDIT',
        currencyCode: 'XOF',
        balanceBefore: 0n,
        balanceAfter: amount,
        status: 'CONFIRMED',
        channel: 'CASH',
        authorId: seller.userId,
        idempotencyKey: randomUUID(),
        createdAt: IN_DAY,
      },
    });
  };

  const logs = () =>
    prisma.activityLog.findMany({ where: { action: 'REPORT_EXPORTED' } });

  describe('GET .../reports/totals/export', () => {
    it('gives an Excel file with the numbers of the report', async () => {
      await deposit(20000n);
      await deposit(5000n);

      const res = await download('totals', {
        ...DAY,
        format: 'xlsx',
      }).expect(200);

      const rows = await readSheet(res.body as Buffer);
      expect(rows[0][0]).toBe('Totaux par période');
      expect(rows[1][0]).toBe('Du 2026-10-10 au 2026-10-10 (UTC)');
      expect(rows.slice(3)).toEqual([
        ['Opérations', 'Nombre', 'Montant (XOF)'],
        ['Dépôts', 2, 25000],
        ['Corrections de dépôts', 0, 0],
        ['Achats de matériaux', 0, 0],
        ['Recrédits', 0, 0],
        ['Espèces reçues', null, 25000],
      ]);
    });

    it('gives a real PDF, sent as a private download', async () => {
      await deposit(20000n);

      const res = await download('totals', {
        ...DAY,
        format: 'pdf',
      }).expect(200);

      const pdf = res.body as Buffer;
      expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
      expect(pdf.toString('latin1').trimEnd().endsWith('%%EOF')).toBe(true);
      expect(res.headers['content-type']).toContain('application/pdf');
      expect(res.headers['content-disposition']).toBe(
        'attachment; filename="rapport-totaux-2026-10-10-2026-10-10.pdf"',
      );
      expect(res.headers['cache-control']).toBe('no-store');
      expect(res.headers['x-content-type-options']).toBe('nosniff');
      const [log] = await logs();
      expect(log.newValue).toMatchObject({ format: 'pdf' });
    });

    it('sends it as a private download with a generated name', async () => {
      const res = await download('totals', {
        ...DAY,
        format: 'xlsx',
      }).expect(200);

      expect(res.headers['content-type']).toContain(XLSX);
      expect(res.headers['content-disposition']).toBe(
        'attachment; filename="rapport-totaux-2026-10-10-2026-10-10.xlsx"',
      );
      expect(res.headers['cache-control']).toBe('no-store');
      expect(res.headers['x-content-type-options']).toBe('nosniff');
    });

    it('logs the export, with no data from the report', async () => {
      await deposit(20000n);

      await download('totals', { ...DAY, format: 'xlsx' }).expect(200);

      const [log, ...others] = await logs();
      expect(others).toEqual([]);
      expect(log.storeId).toBe(storeId);
      expect(log.userId).toBe(manager.userId);
      expect(log.device).toBe(manager.deviceId);
      expect(log.newValue).toEqual({
        report: 'totals',
        ...DAY,
        format: 'xlsx',
        rows: 5,
      });
    });

    it.each([
      ['no format', DAY],
      ['a bad format', { ...DAY, format: 'docx' }],
      ['no dates', { format: 'xlsx' }],
      [
        'an end before the start',
        { from: '2026-10-31', to: '2026-10-01', format: 'xlsx' },
      ],
    ])('refuses %s, and logs nothing', async (_, query) => {
      await download('totals', query).expect(400);

      expect(await logs()).toEqual([]);
    });

    it('is for the store’s manager only, and logs nothing', async () => {
      await download('totals', { ...DAY, format: 'xlsx' }, seller).expect(403);
      await download('totals', { ...DAY, format: 'xlsx' }, outsider).expect(
        404,
      );

      expect(await logs()).toEqual([]);
    });

    it('leaves the on-screen report unlogged', async () => {
      await api()
        .get(`/api/v1/stores/${storeId}/reports/totals`)
        .set('Authorization', manager.authorization)
        .query(DAY)
        .expect(200);

      expect(await logs()).toEqual([]);
    });
  });

  describe('GET .../reports/customers/export', () => {
    /** `count` more customers of the store, quiet for a year. */
    async function manyCustomers(count: number) {
      const old = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000);
      const offset = (await prisma.user.count()) + 1000;
      const ids = Array.from({ length: count }, () => randomUUID());
      await prisma.user.createMany({
        data: ids.map((id, i) => ({
          id,
          phone: `+2237${String(offset + i).padStart(7, '0')}`,
          firstName: 'Client',
          lastName: String(i),
        })),
      });
      await prisma.account.createMany({
        data: ids.map((customerId, i) => ({
          number: `C-9${String(offset + i).padStart(6, '0')}`,
          customerId,
          storeId,
          currencyCode: 'XOF',
          termsAcceptedAt: old,
          openedById: seller.userId,
          createdAt: old,
        })),
      });
    }

    it('holds every customer, beyond one page', async () => {
      await manyCustomers(30);

      const res = await download('customers', { format: 'xlsx' }).expect(200);

      const rows = await readSheet(res.body as Buffer);
      expect(rows[3]).toEqual([
        'Compte',
        'Client',
        'Statut',
        'Dernier dépôt',
        'Solde (XOF)',
      ]);
      expect(rows.slice(4)).toHaveLength(31);
    });

    it('follows the status filter, and logs it', async () => {
      await manyCustomers(3);

      const res = await download('customers', {
        status: 'ACTIVE',
        format: 'xlsx',
      }).expect(200);

      const rows = (await readSheet(res.body as Buffer)).slice(4);
      expect(rows).toHaveLength(1);
      expect(rows[0][2]).toBe('Actif');
      const [log] = await logs();
      expect(log.newValue).toEqual({
        report: 'customers',
        status: 'ACTIVE',
        format: 'xlsx',
        rows: 1,
      });
    });

    it('gives a PDF too, under a dated name', async () => {
      const res = await download('customers', { format: 'pdf' }).expect(200);

      expect((res.body as Buffer).subarray(0, 5).toString()).toBe('%PDF-');
      expect(res.headers['content-disposition']).toMatch(
        /^attachment; filename="rapport-clients-\d{4}-\d{2}-\d{2}\.pdf"$/,
      );
    });

    it('allows 5,000 rows and refuses 5,001, logging nothing then', async () => {
      await manyCustomers(4999);
      await download('customers', { format: 'xlsx' }).expect(200);
      await prisma.activityLog.deleteMany({
        where: { action: 'REPORT_EXPORTED' },
      });
      await manyCustomers(1);

      const res = await download('customers', { format: 'xlsx' }).expect(409);

      const body = JSON.parse((res.body as Buffer).toString()) as {
        error: string;
      };
      expect(body.error).toBe('EXPORT_TOO_LARGE');
      expect(await logs()).toEqual([]);
      await download('customers', { status: 'ACTIVE', format: 'xlsx' }).expect(
        200,
      );
    });

    it('holds no phone', async () => {
      const res = await download('customers', { format: 'xlsx' }).expect(200);

      const text = JSON.stringify(await readSheet(res.body as Buffer));
      expect(text).not.toContain('+22376');
    });

    it('keeps a name beginning with = as text, through the route (F-30)', async () => {
      await prisma.user.updateMany({
        where: { accounts: { some: { id: accountId } } },
        data: { firstName: '=1+1' },
      });

      const res = await download('customers', { format: 'xlsx' }).expect(200);

      const [row] = (await readSheet(res.body as Buffer)).slice(4);
      expect(row[1]).toBe('=1+1 Diallo');
    });

    it('prints a Manding name in a PDF', async () => {
      await prisma.user.updateMany({
        where: { accounts: { some: { id: accountId } } },
        data: { firstName: 'Ŋgolo' },
      });

      const res = await download('customers', { format: 'pdf' }).expect(200);

      expect((res.body as Buffer).subarray(0, 5).toString()).toBe('%PDF-');
    });

    it('is for the manager only, and needs a format', async () => {
      await download('customers', { format: 'pdf' }, seller).expect(403);
      await download('customers', { format: 'pdf' }, outsider).expect(404);
      await download('customers', {}).expect(400);
      await download('customers', { status: 'X', format: 'pdf' }).expect(400);
    });
  });

  describe('GET .../reports/sellers/export', () => {
    it('gives the same numbers as the report', async () => {
      await deposit(20000n);

      const res = await download('sellers', {
        ...DAY,
        format: 'xlsx',
      }).expect(200);

      const rows = await readSheet(res.body as Buffer);
      const moussa = rows.find((row) => String(row[0]).startsWith('Moussa'));
      expect(moussa).toEqual([
        'Moussa Diallo',
        'Vendeur',
        1,
        20000,
        0,
        0,
        0,
        0,
      ]);
      expect(res.headers['content-disposition']).toBe(
        'attachment; filename="rapport-vendeurs-2026-10-10-2026-10-10.xlsx"',
      );
    });

    it('holds no phone (F-30)', async () => {
      const res = await download('sellers', {
        ...DAY,
        format: 'xlsx',
      }).expect(200);

      const text = JSON.stringify(await readSheet(res.body as Buffer));
      expect(text).not.toContain('+22376');
    });

    it('gives a PDF too, logged, with no phone in the log', async () => {
      const res = await download('sellers', { ...DAY, format: 'pdf' }).expect(
        200,
      );

      expect((res.body as Buffer).subarray(0, 5).toString()).toBe('%PDF-');
      const [log] = await logs();
      expect(log.newValue).toEqual({
        report: 'sellers',
        ...DAY,
        format: 'pdf',
        rows: 2,
      });
      expect(JSON.stringify(log)).not.toContain('+22376');
    });

    it('is for the manager only, and refuses bad dates', async () => {
      await download('sellers', { ...DAY, format: 'pdf' }, seller).expect(403);
      await download('sellers', { format: 'pdf' }).expect(400);
    });
  });
});
