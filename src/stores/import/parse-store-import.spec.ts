import ExcelJS from 'exceljs';
import {
  ImportFileError,
  parseStoreImport,
  UNREADABLE_CELL,
  type ImportFileErrorCode,
} from './parse-store-import.js';
import { STORE_IMPORT_COLUMN_NAMES } from './store-import-columns.js';

/** The required columns, in template order (the optional ones left out). */
const REQUIRED = STORE_IMPORT_COLUMN_NAMES.filter(
  (name) => name !== 'settings.terms' && name !== 'settings.deliveryDelayDays',
);

/** A data row whose cell i holds `v<i>`. */
const rowOf = (columns: readonly string[]) => columns.map((_, i) => `v${i}`);

function csv(lines: string[][], separator = ';', eol = '\r\n') {
  return Buffer.from(
    lines.map((line) => line.join(separator)).join(eol) + eol,
    'utf8',
  );
}

async function xlsx(
  rows: ExcelJS.CellValue[][],
  extraSheets: ExcelJS.CellValue[][][] = [],
) {
  const workbook = new ExcelJS.Workbook();
  for (const [index, sheetRows] of [rows, ...extraSheets].entries()) {
    const sheet = workbook.addWorksheet(`Feuille${index + 1}`);
    sheetRows.forEach((row, r) => {
      row.forEach((value, c) => {
        if (value !== undefined) {
          sheet.getCell(r + 1, c + 1).value = value;
        }
      });
    });
  }
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

async function fileError(
  promise: Promise<unknown>,
): Promise<{ code: ImportFileErrorCode; message: string }> {
  const error = await promise.then(
    () => {
      throw new Error('expected an ImportFileError');
    },
    (caught: unknown) => caught,
  );
  expect(error).toBeInstanceOf(ImportFileError);
  const { code, message } = error as ImportFileError;
  return { code, message };
}

describe('parseStoreImport', () => {
  describe('CSV', () => {
    it('reads a ;-separated file, values by column and line numbers', async () => {
      const rows = await parseStoreImport(
        csv([REQUIRED, rowOf(REQUIRED), rowOf(REQUIRED)]),
        'magasins.csv',
      );

      expect(rows).toHaveLength(2);
      expect(rows[0].row).toBe(2);
      expect(rows[1].row).toBe(3);
      expect(rows[0].values).toEqual(
        Object.fromEntries(REQUIRED.map((name, i) => [name, `v${i}`])),
      );
    });

    it('reads a ,-separated file, with LF line ends', async () => {
      const rows = await parseStoreImport(
        csv([REQUIRED, rowOf(REQUIRED)], ',', '\n'),
        'magasins.csv',
      );

      expect(rows[0].values.countryCode).toBe('v0');
      expect(rows[0].values['manager.phone']).toBe(`v${REQUIRED.length - 1}`);
    });

    it('drops a leading BOM, and reads the extension in any case', async () => {
      const content = Buffer.concat([
        Buffer.from([0xef, 0xbb, 0xbf]),
        csv([REQUIRED, rowOf(REQUIRED)]),
      ]);

      const rows = await parseStoreImport(content, 'MAGASINS.CSV');

      expect(rows[0].values.countryCode).toBe('v0');
    });

    it('handles quotes: separators, doubled quotes and line breaks inside', async () => {
      const header = REQUIRED.join(';');
      const cells = rowOf(REQUIRED);
      cells[1] = '"Chez ""Awa""; quincaillerie"';
      cells[2] = '"Rue 12\nHippodrome"';
      const content = Buffer.from(
        `${header}\r\n${cells.join(';')}\r\n${rowOf(REQUIRED).join(';')}\r\n`,
      );

      const rows = await parseStoreImport(content, 'magasins.csv');

      expect(rows[0].values.name).toBe('Chez "Awa"; quincaillerie');
      expect(rows[0].values.address).toBe('Rue 12\nHippodrome');
      // The quoted line break spans lines 2 and 3: the next row is line 4.
      expect(rows.map((row) => row.row)).toEqual([2, 4]);
    });

    it('keeps a quote inside an unquoted cell as text', async () => {
      const cells = rowOf(REQUIRED);
      cells[1] = 'Chez "Awa" et fils';
      const rows = await parseStoreImport(csv([REQUIRED, cells]), 'a.csv');

      expect(rows[0].values.name).toBe('Chez "Awa" et fils');
    });

    it('trims cells, reads blank cells as absent, skips empty lines', async () => {
      const cells = rowOf(REQUIRED);
      cells[0] = '  ML  ';
      cells[1] = '   ';
      const content = csv([
        REQUIRED,
        REQUIRED.map(() => ''),
        cells,
        [],
        rowOf(REQUIRED),
      ]);

      const rows = await parseStoreImport(content, 'magasins.csv');

      expect(rows.map((row) => row.row)).toEqual([3, 5]);
      expect(rows[0].values.countryCode).toBe('ML');
      expect(rows[0].values.name).toBeUndefined();
    });

    it('accepts the optional columns, absent or present', async () => {
      const columns = [...REQUIRED, 'settings.terms'];
      const rows = await parseStoreImport(
        csv([columns, rowOf(columns)]),
        'magasins.csv',
      );

      expect(rows[0].values['settings.terms']).toBe(`v${REQUIRED.length}`);
      expect(rows[0].values).not.toHaveProperty('settings.deliveryDelayDays');
    });

    it('refuses a file that is not UTF-8 (Excel’s plain CSV)', async () => {
      const content = Buffer.concat([
        Buffer.from(`${REQUIRED.join(';')}\r\n`),
        // "Ségou" in Windows-1252.
        Buffer.from([0x53, 0xe9, 0x67, 0x6f, 0x75, 0x0d, 0x0a]),
      ]);

      expect(await fileError(parseStoreImport(content, 'a.csv'))).toEqual({
        code: 'IMPORT_FILE_INVALID',
        message:
          'Le fichier est illisible : enregistrez-le à nouveau au format .xlsx, ou en « CSV UTF-8 »',
      });
    });

    it('refuses an unclosed quote, naming its line', async () => {
      const cells = rowOf(REQUIRED);
      cells[1] = '"never closed';
      const content = csv([REQUIRED, cells]);

      expect(await fileError(parseStoreImport(content, 'a.csv'))).toEqual({
        code: 'IMPORT_FILE_INVALID',
        message: 'Ligne 2 : guillemet non refermé',
      });
    });

    it('refuses values past the header’s columns', async () => {
      const content = csv([REQUIRED, [...rowOf(REQUIRED), 'extra']]);

      expect(await fileError(parseStoreImport(content, 'a.csv'))).toEqual({
        code: 'IMPORT_FILE_INVALID',
        message: 'Ligne 2 : des valeurs hors des colonnes de l’en-tête',
      });
    });

    it('reads 500 rows and refuses 501', async () => {
      const lines = (count: number) => [
        REQUIRED,
        ...Array.from({ length: count }, () => rowOf(REQUIRED)),
      ];

      await expect(
        parseStoreImport(csv(lines(500)), 'a.csv'),
      ).resolves.toHaveLength(500);
      expect(
        await fileError(parseStoreImport(csv(lines(501)), 'a.csv')),
      ).toEqual({
        code: 'IMPORT_TOO_MANY_ROWS',
        message:
          'Le fichier dépasse 500 quincailleries : découpez-le en plusieurs fichiers',
      });
    });
  });

  describe('header', () => {
    it.each<[string, string[], ImportFileErrorCode, string]>([
      [
        'an unknown column',
        [...REQUIRED, 'email'],
        'IMPORT_UNKNOWN_COLUMN',
        'Colonne inconnue : email',
      ],
      [
        'a column named in another case',
        ['CountryCode', ...REQUIRED.slice(1)],
        'IMPORT_UNKNOWN_COLUMN',
        'Colonne inconnue : CountryCode',
      ],
      [
        'a column given twice',
        [...REQUIRED, 'city'],
        'IMPORT_DUPLICATE_COLUMN',
        'Colonne en double : city',
      ],
      [
        'missing required columns',
        REQUIRED.filter((name) => name !== 'city' && name !== 'manager.phone'),
        'IMPORT_MISSING_COLUMN',
        'Colonnes obligatoires absentes : city, manager.phone',
      ],
      [
        'a blank column name between two others',
        ['countryCode', '', ...REQUIRED.slice(1)],
        'IMPORT_UNKNOWN_COLUMN',
        'La colonne 2 de l’en-tête n’a pas de nom',
      ],
    ])('refuses %s', async (_case, header, code, message) => {
      const content = csv([header, header.map(() => 'x')]);

      expect(await fileError(parseStoreImport(content, 'a.csv'))).toEqual({
        code,
        message,
      });
    });

    it('ignores blank header cells after the last column', async () => {
      const rows = await parseStoreImport(
        csv([
          [...REQUIRED, '', ''],
          [...rowOf(REQUIRED), '', ''],
        ]),
        'a.csv',
      );

      expect(rows).toHaveLength(1);
    });
  });

  describe('empty files', () => {
    it.each([
      ['an empty file', Buffer.alloc(0)],
      ['a header only', csv([REQUIRED])],
      ['a header and blank lines', csv([REQUIRED, [], REQUIRED.map(() => '')])],
    ])('refuses %s', async (_case, content) => {
      expect(await fileError(parseStoreImport(content, 'a.csv'))).toEqual({
        code: 'IMPORT_EMPTY',
        message: 'Le fichier ne contient aucune quincaillerie',
      });
    });
  });

  describe('XLSX', () => {
    it('reads text, numbers, rich text, hyperlinks and formula results', async () => {
      const cells: ExcelJS.CellValue[] = rowOf(REQUIRED);
      cells[1] = {
        richText: [{ text: 'Quincaillerie ' }, { text: 'du Carrefour' }],
      };
      cells[2] = { text: 'Rue 12', hyperlink: 'https://example.com' };
      cells[4] = 20220000;
      cells[6] = { formula: '1000000*2', result: 2000000 };
      cells[8] = 2.5;

      const rows = await parseStoreImport(
        await xlsx([REQUIRED, cells]),
        'magasins.xlsx',
      );

      expect(rows[0].row).toBe(2);
      expect(rows[0].values).toMatchObject({
        name: 'Quincaillerie du Carrefour',
        address: 'Rue 12',
        phone: '20220000',
        'settings.maxBalance': '2000000',
        'settings.minDeposit': '2.5',
      });
    });

    it('marks dates, true/false and Excel errors as unreadable', async () => {
      const cells: ExcelJS.CellValue[] = rowOf(REQUIRED);
      cells[1] = new Date('2026-01-01T00:00:00Z');
      cells[2] = true;
      cells[3] = { error: '#DIV/0!' } as ExcelJS.CellErrorValue;

      const rows = await parseStoreImport(
        await xlsx([REQUIRED, cells]),
        'a.xlsx',
      );

      expect(rows[0].values.name).toBe(UNREADABLE_CELL);
      expect(rows[0].values.address).toBe(UNREADABLE_CELL);
      expect(rows[0].values.city).toBe(UNREADABLE_CELL);
    });

    it('marks a whole number past 2^53 as unreadable, not as rounded digits (F-101)', async () => {
      const cells: ExcelJS.CellValue[] = rowOf(REQUIRED);
      // settings.maxBalance: digits that would pass the amount rule rounded.
      cells[6] = 12345678901234568;
      // settings.validationThreshold: the largest safe integer, still digits.
      cells[7] = Number.MAX_SAFE_INTEGER;

      const rows = await parseStoreImport(
        await xlsx([REQUIRED, cells]),
        'a.xlsx',
      );

      expect(rows[0].values['settings.maxBalance']).toBe(UNREADABLE_CELL);
      expect(rows[0].values['settings.validationThreshold']).toBe(
        '9007199254740991',
      );
    });

    it('reads blank cells as absent and skips empty rows, keeping line numbers', async () => {
      const cells: ExcelJS.CellValue[] = rowOf(REQUIRED);
      cells[1] = '   ';
      cells[2] = null;

      const rows = await parseStoreImport(
        await xlsx([REQUIRED, [], cells]),
        'a.xlsx',
      );

      expect(rows.map((row) => row.row)).toEqual([3]);
      expect(rows[0].values.name).toBeUndefined();
      expect(rows[0].values.address).toBeUndefined();
    });

    it('reads the first worksheet only', async () => {
      const rows = await parseStoreImport(
        await xlsx([REQUIRED, rowOf(REQUIRED)], [[['anything'], ['else']]]),
        'a.xlsx',
      );

      expect(rows).toHaveLength(1);
    });

    it('checks the header like a CSV', async () => {
      expect(
        await fileError(
          parseStoreImport(await xlsx([['email'], ['x']]), 'a.xlsx'),
        ),
      ).toEqual({
        code: 'IMPORT_UNKNOWN_COLUMN',
        message: 'Colonne inconnue : email',
      });
    });

    it('refuses 501 rows', async () => {
      const content = await xlsx([
        REQUIRED,
        ...Array.from({ length: 501 }, () => rowOf(REQUIRED)),
      ]);

      expect((await fileError(parseStoreImport(content, 'a.xlsx'))).code).toBe(
        'IMPORT_TOO_MANY_ROWS',
      );
    });

    it.each([
      ['a corrupt file', Buffer.from('not a zip at all')],
      ['a CSV renamed .xlsx', csv([REQUIRED, rowOf(REQUIRED)])],
    ])('refuses %s', async (_case, content) => {
      expect(await fileError(parseStoreImport(content, 'a.xlsx'))).toEqual({
        code: 'IMPORT_FILE_INVALID',
        message:
          'Le fichier est illisible : enregistrez-le à nouveau au format .xlsx, ou en « CSV UTF-8 »',
      });
    });
  });

  it.each(['magasins.xls', 'magasins.pdf', 'magasins', 'csv'])(
    'refuses the file name %s',
    async (name) => {
      expect(await fileError(parseStoreImport(csv([REQUIRED]), name))).toEqual({
        code: 'IMPORT_FILE_INVALID',
        message: 'Le fichier doit être un .csv ou un .xlsx',
      });
    },
  );
});
