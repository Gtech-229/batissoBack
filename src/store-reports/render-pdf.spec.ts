import { fileURLToPath } from 'node:url';
import { inflateSync } from 'node:zlib';
import PDFDocument from 'pdfkit';
import {
  CELL_PADDING,
  columnLayout,
  pdfCellText,
  renderPdf,
} from './render-pdf.js';
import { customersTable, sellersTable } from './report-table.js';
import type { ReportColumn, ReportTable } from './report-table.js';

const TEXT: ReportColumn = { label: 'Nom', kind: 'text' };
const AMOUNT: ReportColumn = { label: 'Montant', kind: 'amount' };
const COUNT: ReportColumn = { label: 'Nombre', kind: 'count' };

const table = (rows: ReportTable['rows']): ReportTable => ({
  title: 'Totaux par période',
  subtitle: 'Du 2026-10-01 au 2026-10-31 (UTC)',
  columns: [TEXT, COUNT, AMOUNT],
  rows,
});

/** The page objects are not compressed, whatever the streams are. */
const pagesOf = (pdf: Buffer) =>
  (pdf.toString('latin1').match(/\/Type \/Page\b(?!s)/g) ?? []).length;

/** Every text map of the PDF: what each glyph used stands for, as Unicode. */
function textMaps(pdf: Buffer): string {
  const text = pdf.toString('latin1');
  const maps: string[] = [];
  for (const match of text.matchAll(/stream\r?\n/g)) {
    const start = match.index + match[0].length;
    const end = text.indexOf('endstream', start);
    try {
      const body = inflateSync(pdf.subarray(start, end), {
        finishFlush: 2,
      }).toString('latin1');
      if (body.includes('begincmap')) {
        maps.push(body);
      }
    } catch {
      // Not a deflated stream (font data): nothing to read here.
    }
  }
  return maps.join('\n').toLowerCase();
}

describe('pdfCellText', () => {
  it.each([
    [1990000n, AMOUNT, '1 990 000'],
    [-1000n, AMOUNT, '-1 000'],
    [0n, AMOUNT, '0'],
    [12345, COUNT, '12 345'],
    ['Dépôts', TEXT, 'Dépôts'],
    ['1000', TEXT, '1000'],
    [null, AMOUNT, ''],
  ])('prints %s', (value, column, printed) => {
    expect(pdfCellText(value, column)).toBe(printed);
  });
});

describe('columnLayout', () => {
  const PAGE = 515;

  it('shares the text width by weight', () => {
    const { columns } = customersTable([], undefined, '2026-11-02', 'XOF');

    const widths = columnLayout(columns, PAGE).map(({ width }) => width);

    expect(widths[1]).toBeCloseTo(widths[0] * 2.5);
    expect(widths[4]).toBe(90);
  });

  it('fills the page and keeps the columns in order', () => {
    const { columns } = customersTable([], undefined, '2026-11-02', 'XOF');

    const layout = columnLayout(columns, PAGE);

    const last = layout[layout.length - 1];
    expect(last.x + last.width - layout[0].x).toBeCloseTo(PAGE);
  });

  it('gives a usual full name its room (F-29)', () => {
    const { columns } = customersTable([], undefined, '2026-11-02', 'XOF');

    // At 9 points, an average letter of DejaVu Sans is about 5.5 points wide.
    const needed = 'Mamadou Lamine Coulibaly'.length * 5.5;

    expect(columnLayout(columns, PAGE)[1].width).toBeGreaterThan(needed);
  });

  describe('sellers, measured in the embedded font (F-31)', () => {
    const doc = new PDFDocument({
      size: 'A4',
      layout: 'landscape',
      margin: 40,
    });
    const LANDSCAPE = doc.page.width - 2 * 40;
    const font = (name: string) =>
      fileURLToPath(new URL(`./fonts/${name}`, import.meta.url));
    const widthOf = (text: string, bold = false) =>
      doc
        .font(font(bold ? 'DejaVuSans-Bold.ttf' : 'DejaVuSans.ttf'))
        .fontSize(9)
        .widthOfString(text);
    const { columns } = sellersTable({
      from: '2026-10-01',
      to: '2026-10-31',
      currencyCode: 'XOF',
      staff: [],
    });
    const layout = columnLayout(columns, LANDSCAPE);
    const room = (index: number) => layout[index].width - CELL_PADDING;

    it('prints a usual full name and the longest role whole', () => {
      expect(widthOf('Aminata Oumou Traoré-Coulibaly')).toBeLessThan(room(0));
      expect(widthOf('Vendeur (ancien)')).toBeLessThan(room(1));
    });

    it('prints every header whole', () => {
      columns.forEach((column, index) => {
        expect(widthOf(column.label, true)).toBeLessThan(room(index));
      });
    });

    it('fills the landscape page', () => {
      const last = layout[layout.length - 1];
      expect(last.x + last.width - layout[0].x).toBeCloseTo(LANDSCAPE);
    });
  });
});

describe('renderPdf', () => {
  it('makes a whole PDF on one page for a short table', async () => {
    const pdf = await renderPdf(table([['Dépôts', 2, 25000n]]));

    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
    expect(pdf.toString('latin1').trimEnd().endsWith('%%EOF')).toBe(true);
    expect(pagesOf(pdf)).toBe(1);
  });

  it('breaks onto new pages for a long table', async () => {
    const rows = Array.from({ length: 200 }, (_, i) => [`Ligne ${i}`, i, 1n]);

    expect(pagesOf(await renderPdf(table(rows)))).toBe(5);
  });

  it('prints an empty table', async () => {
    expect(pagesOf(await renderPdf(table([])))).toBe(1);
  });

  it('stays on one line for a very long name', async () => {
    const pdf = await renderPdf(table([['x'.repeat(2000), 1, 1n]]));

    expect(pagesOf(pdf)).toBe(1);
  });

  it('turns a wide table on its side, and fits every column', async () => {
    const columns = [TEXT, TEXT, COUNT, AMOUNT, COUNT, COUNT, AMOUNT, COUNT];
    const pdf = await renderPdf({
      ...table([]),
      columns,
      rows: [['Moussa', 'Vendeur', 1, 1n, 1, 1, 1n, 1]],
    });

    expect(pdf.toString('latin1')).toMatch(
      /\/MediaBox \[0 0 841\.\d+ 595\.\d+\]/,
    );
  });

  it('embeds its font, and no standard one', async () => {
    const pdf = await renderPdf(table([['Fanta', 1, 1n]]));

    const text = pdf.toString('latin1');
    expect(text).toContain('DejaVuSans');
    expect(text).not.toContain('Helvetica');
  });

  it.each([
    ['ŋ', '014b'],
    ['ɛ', '025b'],
    ['ɔ', '0254'],
    ['ɲ', '0272'],
    ['é', '00e9'],
  ])('prints %s from the font (F-28)', async (letter, unicode) => {
    const pdf = await renderPdf(table([[`Fanta ${letter}`, 1, 1n]]));

    expect(textMaps(pdf)).toContain(unicode);
  });

  it('keeps the rest of a cell after a character outside the font (F-28)', async () => {
    const pdf = await renderPdf(table([['中Zo', 1, 1n]]));

    const maps = textMaps(pdf);
    expect(maps).toContain('005a'); // Z
    expect(maps).toContain('006f'); // o
    expect(pagesOf(pdf)).toBe(1);
  });
});
