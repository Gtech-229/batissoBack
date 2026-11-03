import writeXlsxFile, {
  type Cell,
  type SheetData,
} from 'write-excel-file/node';
import type { ReportCell, ReportColumn, ReportTable } from './report-table.js';

/** Text, always: a name beginning with `=` must not run when the file opens. */
const text = (value: string, bold = false): Cell => ({
  type: String,
  value,
  fontWeight: bold ? 'bold' : undefined,
});

/** A real number, to add up in Excel, unless it would lose digits. */
function numberCell(value: number | bigint): Cell {
  const asNumber = Number(value);
  return Number.isSafeInteger(asNumber)
    ? { type: Number, value: asNumber }
    : text(value.toString());
}

function cell(value: ReportCell, column: ReportColumn): Cell {
  if (value === null) {
    return null;
  }
  return column.kind === 'text' || typeof value === 'string'
    ? text(value.toString())
    : numberCell(value);
}

/** The table as an Excel workbook, in memory. */
export function renderXlsx(table: ReportTable): Promise<Buffer> {
  const data: SheetData = [
    [text(table.title, true)],
    [text(table.subtitle)],
    [],
    table.columns.map((column) => text(column.label, true)),
    ...table.rows.map((row) =>
      row.map((value, index) => cell(value, table.columns[index])),
    ),
  ];
  return writeXlsxFile(data).toBuffer();
}
