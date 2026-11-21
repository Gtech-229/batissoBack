/**
 * The store import's columns (26a), in template order. Each name is the
 * `RegisterStoreDto` path of its field, so a row error's `field` names the
 * column it comes from.
 */
export type StoreImportColumnKind = 'text' | 'amount' | 'integer';

export interface StoreImportColumn {
  name: string;
  required: boolean;
  /** `integer` cells become numbers before validation; others stay strings. */
  kind: StoreImportColumnKind;
}

export const STORE_IMPORT_COLUMNS: readonly StoreImportColumn[] = [
  { name: 'countryCode', required: true, kind: 'text' },
  { name: 'name', required: true, kind: 'text' },
  { name: 'address', required: true, kind: 'text' },
  { name: 'city', required: true, kind: 'text' },
  { name: 'phone', required: true, kind: 'text' },
  { name: 'tradeRegister', required: true, kind: 'text' },
  { name: 'settings.maxBalance', required: true, kind: 'amount' },
  { name: 'settings.validationThreshold', required: true, kind: 'amount' },
  { name: 'settings.minDeposit', required: true, kind: 'amount' },
  { name: 'settings.terms', required: false, kind: 'text' },
  { name: 'settings.deliveryDelayDays', required: false, kind: 'integer' },
  { name: 'manager.firstName', required: true, kind: 'text' },
  { name: 'manager.lastName', required: true, kind: 'text' },
  { name: 'manager.phone', required: true, kind: 'text' },
];

export const STORE_IMPORT_COLUMN_NAMES = STORE_IMPORT_COLUMNS.map(
  (column) => column.name,
);

/** At most this many data rows per file (the header row not counted). */
export const MAX_IMPORT_ROWS = 500;

/** At most this many bytes per uploaded file. */
export const MAX_IMPORT_BYTES = 2 * 1024 * 1024;

/** The template's worksheet name, and the base of its file name. */
export const IMPORT_SHEET_NAME = 'Quincailleries';
export const IMPORT_TEMPLATE_BASENAME = 'modele-quincailleries';
