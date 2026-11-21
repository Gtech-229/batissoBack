import { HttpException, Injectable } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import type { ValidationErrorDetail } from '../../common/errors/error-response.js';
import { toValidationDetails } from '../../common/validation/validation-exception.factory.js';
import { countryNotFound } from '../../countries/countries.errors.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { RegisterStoreDto } from '../dto/register-store.dto.js';
import type {
  StoreImportResult,
  StoreImportRow,
  StoreImportRowError,
} from '../dto/store-import.dto.js';
import {
  countryInactive,
  IMPORT_CELL_UNREADABLE,
  IMPORT_DUPLICATE_IN_FILE,
  IMPORT_DUPLICATE_REGISTERED,
  IMPORT_FILE_MISSING,
  importFileRefused,
} from '../stores.errors.js';
import { StoresService } from '../stores.service.js';
import {
  ImportFileError,
  parseStoreImport,
  UNREADABLE_CELL,
  type ParsedImportRow,
} from './parse-store-import.js';
import { STORE_IMPORT_COLUMNS } from './store-import-columns.js';

/** The global ValidationPipe's options (app.module.ts), for each row. */
const ROW_VALIDATION = { whitelist: true, forbidNonWhitelisted: true };

const INTEGER = /^-?\d+$/;

/** One row once checked: its DTO when it passed every check. */
interface CheckedRow {
  row: number;
  dto?: RegisterStoreDto;
  errors: StoreImportRowError[];
}

export interface UploadedImportFile {
  buffer: Buffer;
  originalname: string;
}

/**
 * Registers stores from a CSV or XLSX file (26a). Each row is checked exactly
 * like POST /admin/stores (RegisterStoreDto, then the service's own checks),
 * plus the import's duplicate rule: one store per trade register and country.
 */
@Injectable()
export class StoreImportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly stores: StoresService,
  ) {}

  async import(
    file: UploadedImportFile | undefined,
    dryRun: boolean,
    adminId: string,
  ): Promise<StoreImportResult> {
    if (!file) {
      throw importFileRefused('IMPORT_FILE_INVALID', IMPORT_FILE_MISSING);
    }
    let parsed: ParsedImportRow[];
    try {
      parsed = await parseStoreImport(file.buffer, file.originalname);
    } catch (error) {
      if (error instanceof ImportFileError) {
        throw importFileRefused(error.code, error.message);
      }
      throw error;
    }

    const checked = await this.check(parsed);
    if (dryRun) {
      const rows = checked.map(({ row, dto, errors }): StoreImportRow => ({
        row,
        status: dto ? 'valid' : 'invalid',
        errors,
      }));
      return summary(rows);
    }

    // Each valid row on its own, in file order, through the very register()
    // of POST /admin/stores (its own transaction): a refusal leaves the rows
    // before and after it alone. Only refusals register() means to make (an
    // HttpException, e.g. the country deactivated since the check) are caught;
    // anything else fails the request, and the stores created so far stay:
    // re-running the file then reports them as already registered.
    const rows: StoreImportRow[] = [];
    for (const { row, dto, errors } of checked) {
      if (!dto) {
        rows.push({ row, status: 'invalid', errors });
        continue;
      }
      try {
        const store = await this.stores.register(dto, adminId);
        rows.push({ row, status: 'created', storeId: store.id, errors: [] });
      } catch (error) {
        if (!(error instanceof HttpException)) {
          throw error;
        }
        rows.push({ row, status: 'rejected', errors: rowErrorsOf(error) });
      }
    }
    return summary(rows);
  }

  /** Every row's errors: validation, country, registration rules, duplicates. */
  private async check(parsed: ParsedImportRow[]): Promise<ValidatedRow[]> {
    const validated = await Promise.all(parsed.map((row) => validateRow(row)));

    const codes = [
      ...new Set(
        validated.flatMap((row) => (row.dto ? [row.dto.countryCode] : [])),
      ),
    ];
    const countries = new Map(
      (
        await this.prisma.country.findMany({
          where: { code: { in: codes } },
          select: { code: true, active: true },
        })
      ).map((country) => [country.code, country.active]),
    );
    for (const row of validated) {
      if (!row.dto) {
        continue;
      }
      const active = countries.get(row.dto.countryCode);
      // The same refusals as register(), in its order: an unknown country,
      // an inactive one, then the rules that need the country.
      const details: ValidationErrorDetail[] =
        active === undefined
          ? [{ field: 'countryCode', errors: [countryNotFound().message] }]
          : !active
            ? [
                {
                  field: 'countryCode',
                  errors: [messageOf(countryInactive(row.dto.countryCode))],
                },
              ]
            : this.stores.registrationErrors(row.dto);
      if (details.length > 0) {
        row.errors.push(...flatten(details));
        row.dto = undefined;
      }
    }

    await this.markDuplicates(validated);
    return validated;
  }

  /**
   * A trade register already used in the same country, by an earlier row of
   * the file or by a registered store (any status), makes the row invalid.
   * Compared trimmed and case-insensitively. Rows whose country or trade
   * register cell is unusable are left out (they already have errors there).
   */
  private async markDuplicates(rows: ValidatedRow[]) {
    const keyed = rows.flatMap((row) => {
      const key = duplicateKey(row);
      return key ? [{ row, ...key }] : [];
    });
    if (keyed.length === 0) {
      return;
    }
    const registered = await this.prisma.$queryRaw<
      { countryCode: string; tradeRegister: string }[]
    >`
      SELECT "countryCode", lower(btrim("tradeRegister")) AS "tradeRegister"
      FROM "hardware_stores"
      WHERE "countryCode" = ANY(${[...new Set(keyed.map((k) => k.countryCode))]})
        AND lower(btrim("tradeRegister")) = ANY(${[...new Set(keyed.map((k) => k.tradeRegister))]})`;
    const taken = new Set(
      registered.map(
        (store) => `${store.countryCode}\u0000${store.tradeRegister}`,
      ),
    );

    const firstRow = new Map<string, number>();
    for (const { row, countryCode, tradeRegister } of keyed) {
      const key = `${countryCode}\u0000${tradeRegister}`;
      const earlier = firstRow.get(key);
      const message =
        earlier !== undefined
          ? IMPORT_DUPLICATE_IN_FILE(earlier)
          : taken.has(key)
            ? IMPORT_DUPLICATE_REGISTERED
            : undefined;
      if (earlier === undefined) {
        firstRow.set(key, row.row);
      }
      if (message) {
        row.errors.push({ field: 'tradeRegister', message });
        row.dto = undefined;
      }
    }
  }
}

/** The row's comparison key: country code and lowercased trade register. */
function duplicateKey(
  row: ValidatedRow,
): { countryCode: string; tradeRegister: string } | undefined {
  const { countryCode, tradeRegister } = row.values;
  if (typeof countryCode !== 'string' || typeof tradeRegister !== 'string') {
    return undefined;
  }
  return {
    countryCode: countryCode.toUpperCase(),
    tradeRegister: tradeRegister.toLowerCase(),
  };
}

interface ValidatedRow extends CheckedRow {
  /** The row's cells, for the duplicate key. */
  values: ParsedImportRow['values'];
}

/** RegisterStoreDto's validation of one row, as the ValidationPipe runs it. */
async function validateRow(parsed: ParsedImportRow): Promise<ValidatedRow> {
  const plain: Record<string, unknown> = {
    settings: {},
    manager: {},
  };
  const unreadable: string[] = [];
  for (const column of STORE_IMPORT_COLUMNS) {
    const value = parsed.values[column.name];
    if (value === UNREADABLE_CELL) {
      unreadable.push(column.name);
      continue;
    }
    if (value === undefined) {
      continue;
    }
    const typed =
      column.kind === 'integer' && INTEGER.test(value) ? Number(value) : value;
    const [head, leaf] = column.name.split('.');
    if (leaf) {
      (plain[head] as Record<string, unknown>)[leaf] = typed;
    } else {
      plain[head] = typed;
    }
  }

  const dto = plainToInstance(RegisterStoreDto, plain);
  const details = toValidationDetails(await validate(dto, ROW_VALIDATION))
    // An unreadable cell has one message of its own, not "required".
    .filter((detail) => !unreadable.includes(detail.field));
  const errors = [
    ...unreadable.map((field) => ({ field, message: IMPORT_CELL_UNREADABLE })),
    ...flatten(details),
  ].sort((a, b) => columnIndex(a.field) - columnIndex(b.field));
  return {
    row: parsed.row,
    values: parsed.values,
    dto: errors.length === 0 ? dto : undefined,
    errors,
  };
}

const COLUMN_ORDER = new Map(
  STORE_IMPORT_COLUMNS.map((column, index) => [column.name, index]),
);

/** Errors in column order; anything else (a nested object) after. */
function columnIndex(field: string): number {
  return COLUMN_ORDER.get(field) ?? STORE_IMPORT_COLUMNS.length;
}

function flatten(details: ValidationErrorDetail[]): StoreImportRowError[] {
  return details.flatMap(({ field, errors }) =>
    errors.map((message) => ({ field, message })),
  );
}

/**
 * A register() refusal as row errors: its field errors when it has some,
 * otherwise its message, on countryCode for the country refusals (the only
 * ones register() makes after a passing check) and on no column otherwise.
 */
export function rowErrorsOf(error: HttpException): StoreImportRowError[] {
  const body = error.getResponse();
  if (typeof body === 'object' && 'details' in body) {
    return flatten(body.details as ValidationErrorDetail[]);
  }
  const code =
    typeof body === 'object' && 'error' in body ? body.error : undefined;
  const countryRefusal =
    code === 'COUNTRY_INACTIVE' || error.getStatus() === 404;
  return [
    { field: countryRefusal ? 'countryCode' : '', message: messageOf(error) },
  ];
}

/** An HttpException's French message, from its { message } body. */
function messageOf(error: { getResponse(): string | object; message: string }) {
  const body = error.getResponse();
  return typeof body === 'object' && 'message' in body
    ? String((body as { message: unknown }).message)
    : error.message;
}

function summary(rows: StoreImportRow[]): StoreImportResult {
  return {
    total: rows.length,
    created: rows.filter((row) => row.status === 'created').length,
    rejected: rows.filter(
      (row) => row.status === 'invalid' || row.status === 'rejected',
    ).length,
    rows,
  };
}
