import { Injectable } from '@nestjs/common';
import { ONE_SNAPSHOT, paginated, toSkipTake } from '../common/pagination.js';
import { formatAmount } from '../common/money.js';
import {
  ActivityAction,
  MaterialOrderStatus,
  OperationChannel,
  OperationDirection,
  OperationStatus,
  OperationType,
  Prisma,
} from '../generated/prisma/client.js';
import type { AuthenticatedUser } from '../mobile-auth/authenticated-user.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { storeCurrencyCode } from '../store-access/verified-store.js';
import { invalidFields } from '../stores/stores.errors.js';
import type {
  ExportCustomersDto,
  ExportFormat,
  ExportPeriodDto,
} from './dto/report-export.dto.js';
import type { ReportPeriodDto } from './dto/report-period.dto.js';
import type {
  CustomersQueryDto,
  CustomersReport,
  CustomerStatus,
  ReportCount,
  SellersReport,
  TotalsReport,
} from './dto/report-views.js';
import { MAX_PERIOD_DAYS, periodRange } from './period-range.js';
import { renderPdf } from './render-pdf.js';
import { renderXlsx } from './render-xlsx.js';
import {
  customersTable,
  sellersTable,
  totalsTable,
  type ReportTable,
} from './report-table.js';
import { EXPORT_MAX_ROWS, exportTooLarge } from './store-reports.errors.js';

/** Compares names as a French reader sorts them (accents, case). */
const FRENCH = new Intl.Collator('fr');

/** With a deposit in these last days, or newer than that, a customer is active. */
const ACTIVE_WINDOW_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

interface CustomerRow {
  accountId: string;
  accountNumber: string;
  firstName: string;
  lastName: string;
  balance: bigint;
  lastDepositAt: Date | null;
  lastActivityAt: Date;
}

/** The orders whose debit happened, whatever followed it. */
const PAID_ORDER_STATUSES = [
  MaterialOrderStatus.CONFIRMED,
  MaterialOrderStatus.DELIVERED,
  MaterialOrderStatus.CANCELLED_AFTER_DEBIT,
];

/** A report as a file, ready to send. */
export interface ReportFile {
  content: Buffer;
  contentType: string;
  fileName: string;
}

const CONTENT_TYPES: Record<ExportFormat, string> = {
  pdf: 'application/pdf',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
};

/** One group of a store's operations over a period. */
interface OperationGroup {
  type: OperationType;
  direction: OperationDirection;
  channel: OperationChannel;
  _count: { _all: number };
  _sum: { amount: bigint | null };
}

function summed(groups: OperationGroup[]): ReportCount {
  return {
    count: groups.reduce((count, group) => count + group._count._all, 0),
    total: formatAmount(totalOf(groups)),
  };
}

function totalOf(groups: OperationGroup[]): bigint {
  return groups.reduce((total, group) => total + (group._sum.amount ?? 0n), 0n);
}

/**
 * A store's reports for its manager (15a). Reads only, computed on request, each
 * from one snapshot, always for the guard's store.
 */
@Injectable()
export class StoreReportsService {
  constructor(private readonly prisma: PrismaService) {}

  /** What happened in the period. Only `CONFIRMED` operations count. */
  async totals(
    storeId: string,
    period: ReportPeriodDto,
  ): Promise<TotalsReport> {
    const { start, end } = this.boundsOf(period);
    const [groups, currencyCode] = await this.prisma.$transaction(
      async (tx) =>
        [
          await tx.operation.groupBy({
            by: ['type', 'direction', 'channel'],
            where: {
              storeId,
              status: OperationStatus.CONFIRMED,
              createdAt: { gte: start, lt: end },
            },
            _count: { _all: true },
            _sum: { amount: true },
          }),
          await storeCurrencyCode(tx, storeId),
        ] as const,
      ONE_SNAPSHOT,
    );

    const of = (type: OperationType, direction?: OperationDirection) =>
      groups.filter(
        (group) =>
          group.type === type &&
          (direction === undefined || group.direction === direction),
      );
    const cash = (selected: OperationGroup[]) =>
      totalOf(
        selected.filter((group) => group.channel === OperationChannel.CASH),
      );
    const deposits = of(OperationType.DEPOSIT);
    const corrections = of(OperationType.CORRECTION, OperationDirection.DEBIT);

    return {
      from: period.from,
      to: period.to,
      currencyCode,
      deposits: summed(deposits),
      corrections: summed(corrections),
      purchases: summed(of(OperationType.MATERIAL_DEBIT)),
      recredits: summed(
        of(OperationType.CORRECTION, OperationDirection.CREDIT),
      ),
      // The cash closing's rule, so the two can be compared.
      netCash: formatAmount(cash(deposits) - cash(corrections)),
    };
  }

  /**
   * The store's customers, the quietest first: those are the ones to call. Active
   * is measured from now, never from a report's dates. A new account counts from
   * its opening, so it starts active. Reading the last deposit in the query keeps
   * the page and the counts in one statement each, on one snapshot.
   */
  async customers(
    storeId: string,
    query: CustomersQueryDto,
  ): Promise<CustomersReport> {
    const { items, activeCount, inactiveCount, total } =
      await this.readCustomers(storeId, query.status, toSkipTake(query));
    return { ...paginated(items, total, query), activeCount, inactiveCount };
  }

  /**
   * The customers matching a filter: a page, or all of them for a file, within
   * `EXPORT_MAX_ROWS`. The counts come first, so a file too large reads no row.
   * Reading the last deposit in the query keeps each read to one statement.
   */
  private async readCustomers(
    storeId: string,
    status: CustomerStatus | undefined,
    page: { skip: number; take: number } | 'all',
  ) {
    const activeSince = new Date(Date.now() - ACTIVE_WINDOW_DAYS * DAY_MS);
    const activity = Prisma.sql`
      SELECT a."id", a."number", a."balance", a."customerId",
        last."at" AS "lastDepositAt",
        COALESCE(last."at", a."createdAt") AS "lastActivityAt"
      FROM "accounts" a
      LEFT JOIN LATERAL (
        SELECT MAX(o."createdAt") AS "at" FROM "operations" o
        WHERE o."accountId" = a."id"
          AND o."type" = 'DEPOSIT'::"OperationType"
          AND o."status" = 'CONFIRMED'::"OperationStatus"
      ) last ON TRUE
      WHERE a."storeId" = ${storeId}::uuid`;
    const statusFilter =
      status === 'ACTIVE'
        ? Prisma.sql`WHERE r."lastActivityAt" >= ${activeSince}`
        : status === 'INACTIVE'
          ? Prisma.sql`WHERE r."lastActivityAt" < ${activeSince}`
          : Prisma.empty;
    const pageClause =
      page === 'all'
        ? Prisma.empty
        : Prisma.sql`LIMIT ${page.take} OFFSET ${page.skip}`;

    return this.prisma.$transaction(async (tx) => {
      const [counts] = await tx.$queryRaw<
        { active: bigint; inactive: bigint }[]
      >`
        SELECT
          COUNT(*) FILTER (WHERE r."lastActivityAt" >= ${activeSince}) AS "active",
          COUNT(*) FILTER (WHERE r."lastActivityAt" < ${activeSince}) AS "inactive"
        FROM (${activity}) r`;
      const activeCount = Number(counts.active);
      const inactiveCount = Number(counts.inactive);
      const total =
        status === 'ACTIVE'
          ? activeCount
          : status === 'INACTIVE'
            ? inactiveCount
            : activeCount + inactiveCount;
      if (page === 'all' && total > EXPORT_MAX_ROWS) {
        throw exportTooLarge();
      }

      const rows = await tx.$queryRaw<CustomerRow[]>`
        SELECT r."id" AS "accountId", r."number" AS "accountNumber",
          u."firstName", u."lastName", r."balance",
          r."lastDepositAt", r."lastActivityAt"
        FROM (${activity}) r
        JOIN "users" u ON u."id" = r."customerId"
        ${statusFilter}
        ORDER BY r."lastActivityAt" ASC, r."id" ASC
        ${pageClause}`;
      const statusOf = (row: CustomerRow): CustomerStatus =>
        row.lastActivityAt >= activeSince ? 'ACTIVE' : 'INACTIVE';

      return {
        items: rows.map((row) => ({
          accountId: row.accountId,
          accountNumber: row.accountNumber,
          firstName: row.firstName,
          lastName: row.lastName,
          balance: formatAmount(row.balance),
          lastDepositAt: row.lastDepositAt,
          status: statusOf(row),
        })),
        total,
        activeCount,
        inactiveCount,
      };
    }, ONE_SNAPSHOT);
  }

  /**
   * What each staff member recorded in the period. Every active member appears,
   * idle or not; a former member only with something to show.
   */
  async sellers(
    storeId: string,
    period: ReportPeriodDto,
  ): Promise<SellersReport> {
    const { start, end } = this.boundsOf(period);
    const createdAt = { gte: start, lt: end };
    const data = await this.prisma.$transaction(
      async (tx) => ({
        currencyCode: await storeCurrencyCode(tx, storeId),
        members: await tx.storeMember.findMany({
          where: { storeId },
          include: {
            user: { select: { firstName: true, lastName: true } },
          },
        }),
        deposits: await tx.operation.groupBy({
          by: ['authorId'],
          where: {
            storeId,
            type: OperationType.DEPOSIT,
            status: OperationStatus.CONFIRMED,
            createdAt,
          },
          _count: { _all: true },
          _sum: { amount: true },
        }),
        prepared: await tx.materialOrder.groupBy({
          by: ['createdById'],
          where: { storeId, createdAt },
          _count: { _all: true },
        }),
        paid: await tx.materialOrder.groupBy({
          by: ['createdById'],
          where: {
            storeId,
            createdAt,
            status: { in: PAID_ORDER_STATUSES },
          },
          _count: { _all: true },
          _sum: { total: true },
        }),
        corrections: await tx.operation.findMany({
          where: {
            storeId,
            type: OperationType.CORRECTION,
            status: OperationStatus.CONFIRMED,
            createdAt,
            correctedOperation: { type: OperationType.DEPOSIT },
          },
          select: { correctedOperation: { select: { authorId: true } } },
        }),
      }),
      ONE_SNAPSHOT,
    );

    const depositsBy = new Map(data.deposits.map((row) => [row.authorId, row]));
    const preparedBy = new Map(
      data.prepared.map((row) => [row.createdById, row._count._all]),
    );
    const paidBy = new Map(data.paid.map((row) => [row.createdById, row]));
    const correctionsBy = new Map<string, number>();
    for (const { correctedOperation } of data.corrections) {
      const author = correctedOperation?.authorId;
      if (author) {
        correctionsBy.set(author, (correctionsBy.get(author) ?? 0) + 1);
      }
    }

    const staff = data.members.map(({ userId, user, role, active }) => {
      const deposits = depositsBy.get(userId);
      const paid = paidBy.get(userId);
      return {
        userId,
        firstName: user.firstName,
        lastName: user.lastName,
        role,
        active,
        deposits: {
          count: deposits?._count._all ?? 0,
          total: formatAmount(deposits?._sum.amount ?? 0n),
        },
        ordersPrepared: preparedBy.get(userId) ?? 0,
        ordersPaid: {
          count: paid?._count._all ?? 0,
          total: formatAmount(paid?._sum.total ?? 0n),
        },
        correctionsOnDeposits: correctionsBy.get(userId) ?? 0,
      };
    });
    // By last name, then first name, in French order (F-26): the database's
    // default compares bytes, putting `Émile` after `Zoé`. The user id only
    // keeps equal names in a stable order.
    staff.sort(
      (a, b) =>
        FRENCH.compare(a.lastName, b.lastName) ||
        FRENCH.compare(a.firstName, b.firstName) ||
        (a.userId < b.userId ? -1 : a.userId > b.userId ? 1 : 0),
    );

    return {
      from: period.from,
      to: period.to,
      currencyCode: data.currencyCode,
      staff: staff.filter(
        (row) =>
          row.active ||
          row.deposits.count > 0 ||
          row.ordersPrepared > 0 ||
          row.correctionsOnDeposits > 0,
      ),
    };
  }

  /** The totals report as a file. */
  async exportTotals(
    storeId: string,
    actor: AuthenticatedUser,
    { format, ...period }: ExportPeriodDto,
  ): Promise<ReportFile> {
    const report = await this.totals(storeId, period);
    return this.toFile(storeId, actor, totalsTable(report), {
      name: `rapport-totaux-${period.from}-${period.to}`,
      format,
      logged: { report: 'totals', ...period },
    });
  }

  /** Every customer matching the filter as a file, within `EXPORT_MAX_ROWS`. */
  async exportCustomers(
    storeId: string,
    actor: AuthenticatedUser,
    { format, status }: ExportCustomersDto,
  ): Promise<ReportFile> {
    const { items } = await this.readCustomers(storeId, status, 'all');
    const today = new Date().toISOString().slice(0, 10);
    const currencyCode = await storeCurrencyCode(this.prisma, storeId);
    const table = customersTable(items, status, today, currencyCode);
    return this.toFile(storeId, actor, table, {
      name: `rapport-clients-${today}`,
      format,
      logged: { report: 'customers', ...(status && { status }) },
    });
  }

  /** The activity by seller as a file. */
  async exportSellers(
    storeId: string,
    actor: AuthenticatedUser,
    { format, ...period }: ExportPeriodDto,
  ): Promise<ReportFile> {
    const report = await this.sellers(storeId, period);
    return this.toFile(storeId, actor, sellersTable(report), {
      name: `rapport-vendeurs-${period.from}-${period.to}`,
      format,
      logged: { report: 'sellers', ...period },
    });
  }

  /**
   * Renders a table and logs the export. The log comes after the file exists, so
   * a refused export leaves no trace. It never holds a customer's name.
   */
  private async toFile(
    storeId: string,
    actor: AuthenticatedUser,
    table: ReportTable,
    file: {
      name: string;
      format: ExportFormat;
      logged: Record<string, string>;
    },
  ): Promise<ReportFile> {
    const content =
      file.format === 'pdf' ? await renderPdf(table) : await renderXlsx(table);
    await this.prisma.activityLog.create({
      data: {
        storeId,
        userId: actor.userId,
        action: ActivityAction.REPORT_EXPORTED,
        newValue: {
          ...file.logged,
          format: file.format,
          rows: table.rows.length,
        },
        device: actor.deviceId,
      },
    });
    return {
      content,
      contentType: CONTENT_TYPES[file.format],
      fileName: `${file.name}.${file.format}`,
    };
  }

  /** The bounds of a valid period, or a 400 on `to`. */
  private boundsOf(period: ReportPeriodDto) {
    const range = periodRange(period.from, period.to);
    if (!range) {
      throw invalidFields([
        {
          field: 'to',
          errors: [
            `La période doit aller de la première date à la seconde, ${MAX_PERIOD_DAYS} jours au plus`,
          ],
        },
      ]);
    }
    return range;
  }
}
