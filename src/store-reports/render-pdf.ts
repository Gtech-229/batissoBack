import { fileURLToPath } from 'node:url';
import PDFDocument from 'pdfkit';
import { groupThousands } from '../notifications/messages.js';
import type { ReportCell, ReportColumn, ReportTable } from './report-table.js';

/**
 * DejaVu Sans, embedded (`fonts/`, copied to `dist/` by nest-cli): it prints the
 * Manding letters of customers' names (`ɛ`, `ɔ`, `ɲ`, `ŋ`). A standard PDF font
 * would garble the rest of a cell after them.
 */
const fontFile = (name: string) =>
  fileURLToPath(new URL(`./fonts/${name}`, import.meta.url));
const REGULAR_FONT = fontFile('DejaVuSans.ttf');
const BOLD_FONT = fontFile('DejaVuSans-Bold.ttf');

const MARGIN = 40;
const ROW_HEIGHT = 18;
const TITLE_SIZE = 16;
const BODY_SIZE = 9;
/** Width of a number column: a text column takes what remains. */
const NUMBER_COLUMN_WIDTH = 90;
/** More columns than this need a page on its side. */
const PORTRAIT_MAX_COLUMNS = 5;

/** What a cell prints. Amounts are grouped by a plain space, as in the texts. */
export function pdfCellText(value: ReportCell, column: ReportColumn): string {
  if (value === null) {
    return '';
  }
  return column.kind === 'text' || typeof value === 'string'
    ? value.toString()
    : groupThousands(BigInt(value));
}

/** The left edge and width of each column, on a page of this usable width. */
export function columnLayout(columns: ReportColumn[], usableWidth: number) {
  const texts = columns.filter((column) => column.kind === 'text');
  const numbersWidth = (columns.length - texts.length) * NUMBER_COLUMN_WIDTH;
  const totalWeight = texts.reduce(
    (sum, column) => sum + (column.weight ?? 1),
    0,
  );
  const widthPerWeight =
    (usableWidth - numbersWidth) / Math.max(totalWeight, 1);
  let x = MARGIN;
  return columns.map((column) => {
    const width =
      column.kind === 'text'
        ? (column.weight ?? 1) * widthPerWeight
        : NUMBER_COLUMN_WIDTH;
    const position = { x, width };
    x += width;
    return position;
  });
}

/**
 * The table as an A4 PDF, in memory. A character outside the font prints as its
 * empty box, and the rest of the cell stays right.
 */
export function renderPdf(table: ReportTable): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: 'A4',
      layout:
        table.columns.length > PORTRAIT_MAX_COLUMNS ? 'landscape' : 'portrait',
      margin: MARGIN,
    });
    const chunks: Buffer[] = [];
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const layout = columnLayout(table.columns, doc.page.width - 2 * MARGIN);
    const bottom = doc.page.height - MARGIN;

    const drawRow = (cells: string[], y: number, bold: boolean) => {
      doc.font(bold ? BOLD_FONT : REGULAR_FONT).fontSize(BODY_SIZE);
      cells.forEach((text, index) => {
        const { x, width } = layout[index];
        doc.text(text, x, y, {
          width: width - 6,
          height: ROW_HEIGHT,
          lineBreak: false,
          ellipsis: true,
          align: table.columns[index].kind === 'text' ? 'left' : 'right',
        });
      });
    };
    const header = table.columns.map((column) => column.label);

    doc.font(BOLD_FONT).fontSize(TITLE_SIZE);
    doc.text(table.title, MARGIN, MARGIN);
    doc.font(REGULAR_FONT).fontSize(BODY_SIZE);
    doc.text(table.subtitle, MARGIN, doc.y + 4);

    let y = doc.y + 16;
    drawRow(header, y, true);
    y += ROW_HEIGHT;
    for (const row of table.rows) {
      if (y + ROW_HEIGHT > bottom) {
        doc.addPage();
        y = MARGIN;
        drawRow(header, y, true);
        y += ROW_HEIGHT;
      }
      const cells = row.map((value, index) =>
        pdfCellText(value, table.columns[index]),
      );
      drawRow(cells, y, false);
      y += ROW_HEIGHT;
    }
    doc.end();
  });
}
