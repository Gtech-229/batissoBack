import ExcelJS from 'exceljs';
import {
  IMPORT_SHEET_NAME,
  IMPORT_TEMPLATE_BASENAME,
  STORE_IMPORT_COLUMN_NAMES,
} from './store-import-columns.js';

export type ImportFormat = 'csv' | 'xlsx';

export interface ImportTemplate {
  content: Buffer;
  contentType: string;
  fileName: string;
}

const UTF8_BOM = '﻿';

/**
 * The empty import template: the header row only. The CSV uses `;` and a BOM,
 * so French Excel opens it in columns with its accents intact.
 */
export async function buildImportTemplate(
  format: ImportFormat,
): Promise<ImportTemplate> {
  const fileName = `${IMPORT_TEMPLATE_BASENAME}.${format}`;
  if (format === 'csv') {
    return {
      content: Buffer.from(
        `${UTF8_BOM}${STORE_IMPORT_COLUMN_NAMES.join(';')}\r\n`,
        'utf8',
      ),
      contentType: 'text/csv; charset=utf-8',
      fileName,
    };
  }
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet(IMPORT_SHEET_NAME);
  sheet.addRow(STORE_IMPORT_COLUMN_NAMES);
  sheet.getRow(1).font = { bold: true };
  // Text format for the whole sheet: phones keep their leading 0 and + sign.
  STORE_IMPORT_COLUMN_NAMES.forEach((name, index) => {
    const column = sheet.getColumn(index + 1);
    column.numFmt = '@';
    column.width = Math.max(14, name.length + 2);
  });
  const content = Buffer.from(await workbook.xlsx.writeBuffer());
  return {
    content,
    contentType:
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    fileName,
  };
}
