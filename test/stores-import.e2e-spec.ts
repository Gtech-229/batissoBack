import type { INestApplication } from '@nestjs/common';
import ExcelJS from 'exceljs';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { STORE_IMPORT_COLUMN_NAMES } from '../src/stores/import/store-import-columns.js';
import { createAdmin } from './utils/admins.js';
import { createMali, createStoreRecord, storeBody } from './utils/countries.js';
import { accessCookieFor, createTestApp } from './utils/app.js';
import { resetDatabase } from './utils/reset-database.js';

const TEMPLATE_URL = '/api/v1/admin/stores/import/template';
const IMPORT_URL = '/api/v1/admin/stores/import';

type Cells = Record<string, string | number | undefined>;

/** A valid row: storeBody()'s values, by column name. */
function rowCells(overrides: Cells = {}): Cells {
  const body = storeBody();
  return {
    countryCode: body.countryCode,
    name: body.name,
    address: body.address,
    city: body.city,
    phone: body.phone,
    tradeRegister: body.tradeRegister,
    'settings.maxBalance': body.settings.maxBalance,
    'settings.validationThreshold': body.settings.validationThreshold,
    'settings.minDeposit': body.settings.minDeposit,
    'manager.firstName': body.manager.firstName,
    'manager.lastName': body.manager.lastName,
    'manager.phone': body.manager.phone,
    ...overrides,
  };
}

/** The JSON body POST /admin/stores receives for the same row. */
function jsonOf(cells: Cells) {
  const body: Record<string, unknown> = {
    settings: {},
    manager: {},
  };
  for (const [name, value] of Object.entries(cells)) {
    if (value === undefined) continue;
    const [head, leaf] = name.split('.');
    if (leaf) (body[head] as Record<string, unknown>)[leaf] = value;
    else body[head] = value;
  }
  return body;
}

function csvFile(rows: Cells[]): Buffer {
  const quote = (value: string | number | undefined) =>
    value === undefined ? '' : `"${String(value).replaceAll('"', '""')}"`;
  return Buffer.from(
    [
      STORE_IMPORT_COLUMN_NAMES.join(';'),
      ...rows.map((row) =>
        STORE_IMPORT_COLUMN_NAMES.map((name) => quote(row[name])).join(';'),
      ),
    ].join('\r\n') + '\r\n',
  );
}

async function xlsxFile(rows: Cells[]): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Quincailleries');
  sheet.addRow(STORE_IMPORT_COLUMN_NAMES);
  for (const row of rows) {
    sheet.addRow(STORE_IMPORT_COLUMN_NAMES.map((name) => row[name] ?? null));
  }
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

/** Field errors as a row lists them: one entry per message. */
function flat(details: { field: string; errors: string[] }[]) {
  return details.flatMap(({ field, errors }) =>
    errors.map((message) => ({ field, message })),
  );
}
const XLSX_TYPE =
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/** Supertest keeps a binary body as a Buffer with this parser. */
function binary(
  response: NodeJS.ReadableStream & { setEncoding(encoding: string): void },
  callback: (error: Error | null, body: Buffer) => void,
) {
  const chunks: Buffer[] = [];
  response.on('data', (chunk: Buffer) => chunks.push(chunk));
  response.on('end', () => callback(null, Buffer.concat(chunks)));
}

describe('Store import (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let cookie: string;

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
  });

  beforeEach(async () => {
    await resetDatabase(prisma);
    await createAdmin(prisma, { email: 'awa@batisso.test' });
    cookie = await accessCookieFor(app, 'awa@batisso.test');
  });

  afterAll(async () => {
    await app.close();
  });

  const api = () => request(app.getHttpServer());
  const upload = (
    content: Buffer,
    fileName: string,
    dryRun: string | null = 'true',
    sessionCookie = cookie,
  ) =>
    api()
      .post(IMPORT_URL)
      .query(dryRun === null ? {} : { dryRun })
      .set('Cookie', sessionCookie)
      .attach('file', content, fileName);

  /** One row per refusal, with a valid one first. */
  async function mixedRows(): Promise<Cells[]> {
    await prisma.country.create({
      data: {
        code: 'SN',
        name: 'Sénégal',
        phonePrefix: '+221',
        currencyCode: 'XOF',
        currencySymbol: 'F CFA',
        decimals: 0,
        active: false,
      },
    });
    // A registered store holding the trade register of row 8.
    await createStoreRecord(prisma);
    return [
      // 2: valid.
      rowCells({ tradeRegister: 'TR-1' }),
      // 3: RegisterStoreDto errors (a blank name, a text amount).
      rowCells({
        tradeRegister: 'TR-2',
        name: undefined,
        'settings.maxBalance': 'beaucoup',
      }),
      // 4: a manager phone of another country.
      rowCells({ tradeRegister: 'TR-3', 'manager.phone': '+221 77 000 00 00' }),
      // 5: an inactive country.
      rowCells({ tradeRegister: 'TR-4', countryCode: 'SN' }),
      // 6: a country the platform does not have.
      rowCells({ tradeRegister: 'TR-5', countryCode: 'NE' }),
      // 7: row 2's trade register again, in another case and with spaces.
      rowCells({ tradeRegister: '  tr-1 ' }),
      // 8: the registered store's trade register.
      rowCells({ tradeRegister: 'ma.bko.2026.b.1234' }),
      // 9: valid, the same manager as row 2 (allowed, as in POST /admin/stores).
      rowCells({ tradeRegister: 'TR-6', name: 'Quincaillerie du Fleuve' }),
    ];
  }

  /** What POST /admin/stores answers for the same row, as row errors. */
  async function singleRegistrationErrors(cells: Cells) {
    const response = await api()
      .post('/api/v1/admin/stores')
      .set('Cookie', cookie)
      .send(jsonOf(cells));
    expect(response.status).not.toBe(201);
    return response.body.details
      ? flat(response.body.details)
      : [{ field: 'countryCode', message: response.body.message }];
  }

  describe('POST /admin/stores/import?dryRun=true', () => {
    it.each([
      ['CSV', 'magasins.csv', csvFile],
      ['XLSX', 'magasins.xlsx', xlsxFile],
    ])(
      'checks a %s file row by row and creates nothing',
      async (_format, fileName, build) => {
        await createMali(prisma);
        const rows = await mixedRows();
        const storesBefore = await prisma.hardwareStore.count();

        const response = await upload(await build(rows), fileName).expect(200);

        expect(response.body).toEqual({
          total: 8,
          created: 0,
          rejected: 6,
          rows: [
            { row: 2, status: 'valid', errors: [] },
            {
              row: 3,
              status: 'invalid',
              errors: await singleRegistrationErrors(rows[1]),
            },
            {
              row: 4,
              status: 'invalid',
              errors: await singleRegistrationErrors(rows[2]),
            },
            {
              row: 5,
              status: 'invalid',
              errors: await singleRegistrationErrors(rows[3]),
            },
            {
              row: 6,
              status: 'invalid',
              errors: [{ field: 'countryCode', message: 'Pays introuvable' }],
            },
            {
              row: 7,
              status: 'invalid',
              errors: [
                {
                  field: 'tradeRegister',
                  message:
                    'Ce registre du commerce figure déjà à la ligne 2 du fichier, pour ce pays',
                },
              ],
            },
            {
              row: 8,
              status: 'invalid',
              errors: [
                {
                  field: 'tradeRegister',
                  message:
                    'Une quincaillerie de ce pays est déjà inscrite avec ce registre du commerce',
                },
              ],
            },
            { row: 9, status: 'valid', errors: [] },
          ],
        });
        // The single route refused rows 3 to 5 too: nothing was created.
        expect(await prisma.hardwareStore.count()).toBe(storesBefore);
      },
    );

    it('reports an unreadable XLSX cell on its column', async () => {
      await createMali(prisma);
      const workbook = new ExcelJS.Workbook();
      const sheet = workbook.addWorksheet('Quincailleries');
      sheet.addRow(STORE_IMPORT_COLUMN_NAMES);
      sheet.addRow(
        STORE_IMPORT_COLUMN_NAMES.map((name) =>
          name === 'city' ? new Date('2026-01-01') : (rowCells()[name] ?? null),
        ),
      );
      const content = Buffer.from(await workbook.xlsx.writeBuffer());

      const response = await upload(content, 'a.xlsx').expect(200);

      expect(response.body.rows).toEqual([
        {
          row: 2,
          status: 'invalid',
          errors: [
            {
              field: 'city',
              message:
                'Valeur illisible : saisissez-la comme du texte ou un nombre',
            },
          ],
        },
      ]);
    });

    it('validates the optional columns: a non-integer delivery delay', async () => {
      await createMali(prisma);
      const cells = rowCells({ 'settings.deliveryDelayDays': '2,5' });

      const response = await upload(csvFile([cells]), 'a.csv').expect(200);

      expect(response.body.rows[0]).toEqual({
        row: 2,
        status: 'invalid',
        errors: await singleRegistrationErrors({
          ...cells,
          'settings.deliveryDelayDays': 2.5,
        }),
      });
    });
  });

  describe('POST /admin/stores/import?dryRun=false', () => {
    it('creates exactly the valid rows, like POST /admin/stores', async () => {
      await createMali(prisma);
      const rows = await mixedRows();
      const admin = await prisma.admin.findUniqueOrThrow({
        where: { email: 'awa@batisso.test' },
      });

      const response = await upload(csvFile(rows), 'a.csv', 'false').expect(
        200,
      );

      expect(response.body).toMatchObject({
        total: 8,
        created: 2,
        rejected: 6,
      });
      const statuses = response.body.rows.map(
        (row: { row: number; status: string }) => [row.row, row.status],
      );
      expect(statuses).toEqual([
        [2, 'created'],
        [3, 'invalid'],
        [4, 'invalid'],
        [5, 'invalid'],
        [6, 'invalid'],
        [7, 'invalid'],
        [8, 'invalid'],
        [9, 'created'],
      ]);

      const ids = response.body.rows
        .filter((row: { storeId?: string }) => row.storeId)
        .map((row: { storeId: string }) => row.storeId);
      const created = await prisma.hardwareStore.findMany({
        where: { id: { in: ids } },
        include: { settings: true, members: true, categories: true },
        orderBy: { tradeRegister: 'asc' },
      });
      expect(created.map((store) => store.tradeRegister)).toEqual([
        'TR-1',
        'TR-6',
      ]);
      // The same manager, a new person found by phone for both stores.
      const managers = await prisma.user.findMany({
        where: { phone: '+22376000000' },
      });
      expect(managers).toHaveLength(1);
      for (const store of created) {
        expect(store).toMatchObject({
          status: 'PENDING',
          createdById: admin.id,
          phone: '+22320220000',
        });
        expect(store.settings?.maxBalance).toBe(2000000n);
        expect(store.members).toEqual([
          expect.objectContaining({
            role: 'MANAGER',
            active: true,
            userId: managers[0].id,
          }),
        ]);
        expect(store.categories.length).toBeGreaterThan(0);
      }
      // The registered store plus the two created.
      expect(await prisma.hardwareStore.count()).toBe(3);
    });

    it('re-running the same file creates nothing twice', async () => {
      await createMali(prisma);
      const content = csvFile(await mixedRows());
      await upload(content, 'a.csv', 'false').expect(200);

      const again = await upload(content, 'a.csv', 'false').expect(200);

      expect(again.body).toMatchObject({ total: 8, created: 0, rejected: 8 });
      const registered = {
        field: 'tradeRegister',
        message:
          'Une quincaillerie de ce pays est déjà inscrite avec ce registre du commerce',
      };
      expect(again.body.rows[0]).toEqual({
        row: 2,
        status: 'invalid',
        errors: [registered],
      });
      expect(again.body.rows[7]).toEqual({
        row: 9,
        status: 'invalid',
        errors: [registered],
      });
      expect(await prisma.hardwareStore.count()).toBe(3);
    });
  });

  describe('POST /admin/stores/import: refused files', () => {
    const header = STORE_IMPORT_COLUMN_NAMES.join(';');

    it.each<[string, () => request.Test, string, string]>([
      [
        'a file that is not .csv or .xlsx',
        () => upload(csvFile([rowCells()]), 'magasins.txt'),
        'IMPORT_FILE_INVALID',
        'Le fichier doit être un .csv ou un .xlsx',
      ],
      [
        'a file over 2 MB',
        () =>
          upload(
            Buffer.concat([
              Buffer.from(`${header}\r\n`),
              Buffer.alloc(2 * 1024 * 1024, 'a'),
            ]),
            'a.csv',
          ),
        'IMPORT_FILE_INVALID',
        'Le fichier dépasse 2 Mo',
      ],
      [
        '501 rows',
        () =>
          upload(
            csvFile(Array.from({ length: 501 }, () => rowCells())),
            'a.csv',
          ),
        'IMPORT_TOO_MANY_ROWS',
        'Le fichier dépasse 500 quincailleries : découpez-le en plusieurs fichiers',
      ],
      [
        'an unknown column',
        () =>
          upload(
            Buffer.from(`${header};email\r\n${';'.repeat(14)}x\r\n`),
            'a.csv',
          ),
        'IMPORT_UNKNOWN_COLUMN',
        'Colonne inconnue : email',
      ],
      [
        'a corrupt XLSX',
        () => upload(Buffer.from('not a zip'), 'a.xlsx'),
        'IMPORT_FILE_INVALID',
        'Le fichier est illisible : enregistrez-le à nouveau au format .xlsx, ou en « CSV UTF-8 »',
      ],
      [
        'no file',
        () =>
          api()
            .post(IMPORT_URL)
            .query({ dryRun: 'true' })
            .set('Cookie', cookie),
        'IMPORT_FILE_INVALID',
        'Joignez le fichier à importer (.csv ou .xlsx) dans le champ « file »',
      ],
      [
        'another field next to the file',
        () => upload(csvFile([rowCells()]), 'a.csv').field('note', 'x'),
        'IMPORT_FILE_INVALID',
        'Envoyez un seul fichier (.csv ou .xlsx) dans le champ « file », et rien d’autre',
      ],
    ])('refuses %s', async (_case, send, error, message) => {
      await createMali(prisma);

      const response = await send().expect(400);

      expect(response.body).toMatchObject({ statusCode: 400, error, message });
      expect(await prisma.hardwareStore.count()).toBe(0);
    });

    it.each([
      ['missing', null],
      ['not true or false', 'yes'],
    ])('refuses a dryRun %s', async (_case, dryRun) => {
      const response = await upload(
        csvFile([rowCells()]),
        'a.csv',
        dryRun,
      ).expect(400);

      expect(response.body.details).toEqual([
        { field: 'dryRun', errors: ['dryRun doit valoir true ou false'] },
      ]);
    });

    it('requires stores.manage', async () => {
      await createAdmin(prisma, {
        email: 'reader@batisso.test',
        permissions: ['stores.read'],
      });
      const readerCookie = await accessCookieFor(app, 'reader@batisso.test');

      await upload(csvFile([rowCells()]), 'a.csv', 'true', readerCookie).expect(
        403,
      );
    });

    it('requires a signed-in admin', async () => {
      await api()
        .post(IMPORT_URL)
        .query({ dryRun: 'true' })
        .attach('file', csvFile([rowCells()]), 'a.csv')
        .expect(401);
    });
  });

  describe('GET /admin/stores/import/template', () => {
    it('returns the CSV template: BOM, then the header row with ;', async () => {
      const response = await api()
        .get(TEMPLATE_URL)
        .query({ format: 'csv' })
        .set('Cookie', cookie)
        .buffer(true)
        .parse(binary as never)
        .expect(200);

      expect(response.headers['content-type']).toBe('text/csv; charset=utf-8');
      expect(response.headers['content-disposition']).toBe(
        'attachment; filename="modele-quincailleries.csv"',
      );
      const body = response.body as Buffer;
      expect([...body.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
      expect(body.subarray(3).toString('utf8')).toBe(
        `${STORE_IMPORT_COLUMN_NAMES.join(';')}\r\n`,
      );
    });

    it('returns the XLSX template: one sheet, the header row only', async () => {
      const response = await api()
        .get(TEMPLATE_URL)
        .query({ format: 'xlsx' })
        .set('Cookie', cookie)
        .buffer(true)
        .parse(binary as never)
        .expect(200);

      expect(response.headers['content-type']).toBe(XLSX_TYPE);
      expect(response.headers['content-disposition']).toBe(
        'attachment; filename="modele-quincailleries.xlsx"',
      );
      const workbook = new ExcelJS.Workbook();
      // exceljs types its input as its own Buffer interface (an ArrayBuffer).
      await workbook.xlsx.load(
        (response.body as Buffer).buffer as unknown as ExcelJS.Buffer,
      );
      expect(workbook.worksheets.map((sheet) => sheet.name)).toEqual([
        'Quincailleries',
      ]);
      const sheet = workbook.worksheets[0];
      expect(sheet.rowCount).toBe(1);
      expect((sheet.getRow(1).values as unknown[]).slice(1)).toEqual(
        STORE_IMPORT_COLUMN_NAMES,
      );
    });

    it.each([
      ['a format other than csv or xlsx', { format: 'pdf' }],
      ['no format', {}],
    ])('refuses %s', async (_case, query) => {
      const response = await api()
        .get(TEMPLATE_URL)
        .query(query)
        .set('Cookie', cookie)
        .expect(400);

      expect(response.body.details).toEqual([
        { field: 'format', errors: ['Le format doit être csv ou xlsx'] },
      ]);
    });

    it('requires stores.manage', async () => {
      await createAdmin(prisma, {
        email: 'reader@batisso.test',
        permissions: ['stores.read'],
      });
      const readerCookie = await accessCookieFor(app, 'reader@batisso.test');

      await api()
        .get(TEMPLATE_URL)
        .query({ format: 'csv' })
        .set('Cookie', readerCookie)
        .expect(403);
    });

    it('requires a signed-in admin', async () => {
      await api().get(TEMPLATE_URL).query({ format: 'csv' }).expect(401);
    });
  });
});
