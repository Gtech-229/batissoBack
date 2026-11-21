import ExcelJS from 'exceljs';
import {
  MAX_IMPORT_ROWS,
  STORE_IMPORT_COLUMNS,
} from './store-import-columns.js';

/**
 * A cell that holds no usable text (a date, a true/false, an Excel error):
 * kept as this marker so its field fails validation with its own message.
 */
export const UNREADABLE_CELL = Symbol('unreadable cell');

export type ImportCellValue = string | typeof UNREADABLE_CELL | undefined;

export interface ParsedImportRow {
  /** The spreadsheet line number: the header is line 1. */
  row: number;
  /** By column name; a blank cell or a missing optional column is undefined. */
  values: Record<string, ImportCellValue>;
}

export type ImportFileErrorCode =
  | 'IMPORT_FILE_INVALID'
  | 'IMPORT_EMPTY'
  | 'IMPORT_TOO_MANY_ROWS'
  | 'IMPORT_UNKNOWN_COLUMN'
  | 'IMPORT_MISSING_COLUMN'
  | 'IMPORT_DUPLICATE_COLUMN';

/**
 * A problem with the file as a whole: nothing in it is validated. The message
 * names columns and line numbers only, never a cell's value.
 */
export class ImportFileError extends Error {
  override readonly name = 'ImportFileError';

  constructor(
    readonly code: ImportFileErrorCode,
    message: string,
  ) {
    super(message);
  }
}

const NOT_CSV_OR_XLSX = 'Le fichier doit être un .csv ou un .xlsx';
const UNREADABLE_FILE =
  'Le fichier est illisible : enregistrez-le à nouveau au format .xlsx, ou en « CSV UTF-8 »';
const NO_ROWS = 'Le fichier ne contient aucune quincaillerie';
const TOO_MANY_ROWS = `Le fichier dépasse ${MAX_IMPORT_ROWS} quincailleries : découpez-le en plusieurs fichiers`;

const KNOWN_COLUMNS = new Set(
  STORE_IMPORT_COLUMNS.map((column) => column.name),
);

/**
 * Reads an uploaded import file (26a) into header-checked rows. Pure: no
 * validation of the values, which is the registration's job.
 */
export async function parseStoreImport(
  content: Buffer,
  fileName: string,
): Promise<ParsedImportRow[]> {
  const extension = /\.([^.]+)$/.exec(fileName)?.[1]?.toLowerCase();
  if (extension === 'csv') {
    return toRows(readCsv(content));
  }
  if (extension === 'xlsx') {
    return toRows(await readXlsx(content));
  }
  throw new ImportFileError('IMPORT_FILE_INVALID', NOT_CSV_OR_XLSX);
}

/** One line of the file: its number and its cells, left to right. */
interface RawLine {
  line: number;
  cells: ImportCellValue[];
}

/** The header line first, then the non-empty lines. */
function toRows(lines: RawLine[]): ParsedImportRow[] {
  const [header, ...data] = lines;
  if (!header) {
    throw new ImportFileError('IMPORT_EMPTY', NO_ROWS);
  }
  const columns = checkHeader(header.cells);
  const rows = data.filter((line) =>
    line.cells.some((cell) => cell !== undefined),
  );
  if (rows.length === 0) {
    throw new ImportFileError('IMPORT_EMPTY', NO_ROWS);
  }
  return rows.map(({ line, cells }) => {
    if (cells.slice(columns.length).some((cell) => cell !== undefined)) {
      throw new ImportFileError(
        'IMPORT_FILE_INVALID',
        `Ligne ${line} : des valeurs hors des colonnes de l’en-tête`,
      );
    }
    const values: Record<string, ImportCellValue> = {};
    columns.forEach((name, index) => {
      values[name] = cells[index];
    });
    return { row: line, values };
  });
}

/** The header's column names, checked against the template's columns. */
function checkHeader(cells: ImportCellValue[]): string[] {
  // Trailing blank header cells are only formatting.
  let width = cells.length;
  while (width > 0 && cells[width - 1] === undefined) {
    width--;
  }
  const names = cells.slice(0, width).map((cell, index) => {
    if (typeof cell !== 'string') {
      throw new ImportFileError(
        'IMPORT_UNKNOWN_COLUMN',
        `La colonne ${index + 1} de l’en-tête n’a pas de nom`,
      );
    }
    if (!KNOWN_COLUMNS.has(cell)) {
      throw new ImportFileError(
        'IMPORT_UNKNOWN_COLUMN',
        `Colonne inconnue : ${cell}`,
      );
    }
    return cell;
  });
  const seen = new Set<string>();
  for (const name of names) {
    if (seen.has(name)) {
      throw new ImportFileError(
        'IMPORT_DUPLICATE_COLUMN',
        `Colonne en double : ${name}`,
      );
    }
    seen.add(name);
  }
  const missing = STORE_IMPORT_COLUMNS.filter(
    (column) => column.required && !seen.has(column.name),
  ).map((column) => column.name);
  if (missing.length > 0) {
    throw new ImportFileError(
      'IMPORT_MISSING_COLUMN',
      `Colonnes obligatoires absentes : ${missing.join(', ')}`,
    );
  }
  return names;
}

/** A trimmed cell, or undefined when blank. */
function textCell(text: string): string | undefined {
  const trimmed = text.trim();
  return trimmed === '' ? undefined : trimmed;
}

/**
 * Collects the lines in file order. The first one is the header; past
 * MAX_IMPORT_ROWS non-empty data lines the file is refused at once, before
 * anything else is read or validated.
 */
function lineCollector() {
  const lines: RawLine[] = [];
  let dataLines = 0;
  return {
    lines,
    push(line: RawLine) {
      const isData =
        lines.length > 0 && line.cells.some((cell) => cell !== undefined);
      if (isData && ++dataLines > MAX_IMPORT_ROWS) {
        throw new ImportFileError('IMPORT_TOO_MANY_ROWS', TOO_MANY_ROWS);
      }
      lines.push(line);
    },
  };
}

/**
 * RFC 4180 CSV in UTF-8 (a leading BOM is dropped): quoted fields, doubled
 * quotes, line breaks inside quotes. The separator is `;` when the header line
 * has more of them than `,` (French Excel), otherwise `,`.
 */
function readCsv(content: Buffer): RawLine[] {
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(content);
  } catch {
    // Not UTF-8: most likely Excel's plain "CSV" (Windows-1252).
    throw new ImportFileError('IMPORT_FILE_INVALID', UNREADABLE_FILE);
  }
  if (text.startsWith('﻿')) {
    text = text.slice(1);
  }
  const firstLine = text.split(/\r?\n/, 1)[0] ?? '';
  const separator =
    (firstLine.match(/;/g)?.length ?? 0) > (firstLine.match(/,/g)?.length ?? 0)
      ? ';'
      : ',';

  const collected = lineCollector();
  let cells: ImportCellValue[] = [];
  let field = '';
  let quoted = false;
  let line = 1;
  let lineStart = 1;
  const endField = () => {
    cells.push(textCell(field));
    field = '';
  };
  const endLine = () => {
    endField();
    collected.push({ line: lineStart, cells });
    cells = [];
  };

  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (quoted) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          quoted = false;
        }
      } else {
        if (char === '\n') {
          line++;
        }
        field += char;
      }
    } else if (char === '"' && field === '') {
      // Only a cell's first character opens quotes: a quote inside an
      // unquoted cell (Chez "Awa") is kept as text.
      quoted = true;
    } else if (char === separator) {
      endField();
    } else if (char === '\r' && text[i + 1] === '\n') {
      // The \n ends the line.
    } else if (char === '\n' || char === '\r') {
      endLine();
      line++;
      lineStart = line;
    } else {
      field += char;
    }
  }
  if (quoted) {
    throw new ImportFileError(
      'IMPORT_FILE_INVALID',
      `Ligne ${lineStart} : guillemet non refermé`,
    );
  }
  // The last line, unless the file ends with a line break.
  if (field !== '' || cells.length > 0) {
    endLine();
  }
  return collected.lines;
}

/** The first worksheet of an .xlsx file, its cells as text. */
async function readXlsx(content: Buffer): Promise<RawLine[]> {
  const workbook = new ExcelJS.Workbook();
  try {
    // exceljs types its input as its own Buffer interface (an ArrayBuffer).
    await workbook.xlsx.load(
      content.buffer.slice(
        content.byteOffset,
        content.byteOffset + content.byteLength,
      ) as unknown as ExcelJS.Buffer,
    );
  } catch {
    throw new ImportFileError('IMPORT_FILE_INVALID', UNREADABLE_FILE);
  }
  const sheet = workbook.worksheets[0];
  if (!sheet) {
    throw new ImportFileError('IMPORT_EMPTY', NO_ROWS);
  }
  const collected = lineCollector();
  sheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    const cells: ImportCellValue[] = [];
    row.eachCell({ includeEmpty: true }, (cell, column) => {
      cells[column - 1] = xlsxCell(cell.value);
    });
    collected.push({ line: rowNumber, cells: Array.from(cells) });
  });
  return collected.lines;
}

/** One .xlsx cell as text, or the unreadable marker. */
function xlsxCell(value: ExcelJS.CellValue): ImportCellValue {
  if (value === null || value === undefined) {
    return undefined;
  }
  if (typeof value === 'string') {
    return textCell(value);
  }
  if (typeof value === 'number') {
    // A safe integer as its digits (76000000, not 7.6e7); anything else as
    // its plain decimal text, which the amount rules then refuse.
    return textCell(
      Number.isSafeInteger(value) ? value.toFixed(0) : String(value),
    );
  }
  if (typeof value === 'boolean' || value instanceof Date) {
    return UNREADABLE_CELL;
  }
  if ('richText' in value) {
    return textCell(value.richText.map((part) => part.text).join(''));
  }
  if ('error' in value) {
    return UNREADABLE_CELL;
  }
  if ('formula' in value || 'sharedFormula' in value) {
    // The value Excel saved; no formula is ever evaluated here.
    return xlsxCell((value as { result?: ExcelJS.CellValue }).result ?? null);
  }
  if ('text' in value) {
    // A hyperlink cell: its displayed text.
    return typeof value.text === 'string'
      ? textCell(value.text)
      : xlsxCell(value.text as ExcelJS.CellValue);
  }
  return UNREADABLE_CELL;
}
