import type {
  CustomerReportRow,
  CustomerStatus,
  SellersReport,
  TotalsReport,
} from './dto/report-views.js';

export type ReportCell = string | number | bigint | null;

export interface ReportColumn {
  label: string;
  kind: 'text' | 'amount' | 'count';
  /** A text column's share of the page against the other text columns (default 1). */
  weight?: number;
}

/**
 * A report as a table. Each report maps to one, and both renderers read only
 * this, so a PDF and an Excel file of one report cannot disagree.
 */
export interface ReportTable {
  title: string;
  subtitle: string;
  columns: ReportColumn[];
  rows: ReportCell[][];
}

/** The subtitle of a period: the days are the report's, inclusive. */
function periodLabel(from: string, to: string): string {
  return `Du ${from} au ${to} (UTC)`;
}

export function totalsTable(report: TotalsReport): ReportTable {
  const line = (
    label: string,
    { count, total }: TotalsReport['deposits'],
  ): ReportCell[] => [label, count, BigInt(total)];
  return {
    title: 'Totaux par période',
    subtitle: periodLabel(report.from, report.to),
    columns: [
      { label: 'Opérations', kind: 'text' },
      { label: 'Nombre', kind: 'count' },
      { label: `Montant (${report.currencyCode})`, kind: 'amount' },
    ],
    rows: [
      line('Dépôts', report.deposits),
      line('Corrections de dépôts', report.corrections),
      line('Achats de matériaux', report.purchases),
      line('Recrédits', report.recredits),
      ['Espèces reçues', null, BigInt(report.netCash)],
    ],
  };
}

const CUSTOMER_STATUS_LABELS: Record<CustomerStatus, string> = {
  ACTIVE: 'Actif',
  INACTIVE: 'Inactif',
};

export function customersTable(
  rows: CustomerReportRow[],
  status: CustomerStatus | undefined,
  today: string,
  currencyCode: string,
): ReportTable {
  const scope =
    status === 'ACTIVE'
      ? 'clients actifs'
      : status === 'INACTIVE'
        ? 'clients inactifs'
        : 'tous les clients';
  return {
    title: 'Clients actifs et inactifs',
    subtitle: `Au ${today} (UTC), ${scope}`,
    columns: [
      { label: 'Compte', kind: 'text', weight: 2 },
      { label: 'Client', kind: 'text', weight: 5 },
      { label: 'Statut', kind: 'text', weight: 1.5 },
      { label: 'Dernier dépôt', kind: 'text', weight: 2 },
      { label: `Solde (${currencyCode})`, kind: 'amount' },
    ],
    rows: rows.map((row) => [
      row.accountNumber,
      `${row.firstName} ${row.lastName}`,
      CUSTOMER_STATUS_LABELS[row.status],
      row.lastDepositAt?.toISOString().slice(0, 10) ?? 'Aucun',
      BigInt(row.balance),
    ]),
  };
}

export function sellersTable(report: SellersReport): ReportTable {
  return {
    title: 'Activité par vendeur',
    subtitle: `${periodLabel(report.from, report.to)}, montants en ${report.currencyCode}`,
    columns: [
      // A usual full name needs about 150 pt; the role, 77 pt (F-31).
      { label: 'Membre', kind: 'text', weight: 2 },
      { label: 'Rôle', kind: 'text', weight: 1 },
      { label: 'Dépôts', kind: 'count' },
      { label: 'Montant', kind: 'amount' },
      { label: 'Bons préparés', kind: 'count' },
      { label: 'Bons payés', kind: 'count' },
      { label: 'Montant payé', kind: 'amount' },
      { label: 'Corrections', kind: 'count' },
    ],
    rows: report.staff.map((row) => [
      `${row.firstName} ${row.lastName}`,
      `${row.role === 'MANAGER' ? 'Gérant' : 'Vendeur'}${row.active ? '' : ' (ancien)'}`,
      row.deposits.count,
      BigInt(row.deposits.total),
      row.ordersPrepared,
      row.ordersPaid.count,
      BigInt(row.ordersPaid.total),
      row.correctionsOnDeposits,
    ]),
  };
}
