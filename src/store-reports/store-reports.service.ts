import { Injectable } from '@nestjs/common';
import { ONE_SNAPSHOT, toSkipTake } from '../common/pagination.js';
import { formatAmount } from '../common/money.js';
import {
  MaterialOrderStatus,
  OperationChannel,
  OperationDirection,
  OperationStatus,
  OperationType,
  Prisma,
} from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { invalidFields, storeNotFound } from '../stores/stores.errors.js';
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

type Tx = Prisma.TransactionClient;

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
          await this.currencyOf(tx, storeId),
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
    const activeSince = new Date(Date.now() - ACTIVE_WINDOW_DAYS * DAY_MS);
    const { skip, take } = toSkipTake(query);
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
      query.status === 'ACTIVE'
        ? Prisma.sql`WHERE r."lastActivityAt" >= ${activeSince}`
        : query.status === 'INACTIVE'
          ? Prisma.sql`WHERE r."lastActivityAt" < ${activeSince}`
          : Prisma.empty;

    const [rows, [counts]] = await this.prisma.$transaction(
      async (tx) =>
        [
          await tx.$queryRaw<CustomerRow[]>`
            SELECT r."id" AS "accountId", r."number" AS "accountNumber",
              u."firstName", u."lastName", r."balance",
              r."lastDepositAt", r."lastActivityAt"
            FROM (${activity}) r
            JOIN "users" u ON u."id" = r."customerId"
            ${statusFilter}
            ORDER BY r."lastActivityAt" ASC, r."id" ASC
            LIMIT ${take} OFFSET ${skip}`,
          await tx.$queryRaw<{ active: bigint; inactive: bigint }[]>`
            SELECT
              COUNT(*) FILTER (WHERE r."lastActivityAt" >= ${activeSince}) AS "active",
              COUNT(*) FILTER (WHERE r."lastActivityAt" < ${activeSince}) AS "inactive"
            FROM (${activity}) r`,
        ] as const,
      ONE_SNAPSHOT,
    );

    const activeCount = Number(counts.active);
    const inactiveCount = Number(counts.inactive);
    const total =
      query.status === 'ACTIVE'
        ? activeCount
        : query.status === 'INACTIVE'
          ? inactiveCount
          : activeCount + inactiveCount;
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
      page: query.page,
      pageSize: query.pageSize,
      activeCount,
      inactiveCount,
    };
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
        currencyCode: await this.currencyOf(tx, storeId),
        members: await tx.storeMember.findMany({
          where: { storeId },
          include: {
            user: { select: { firstName: true, lastName: true } },
          },
          orderBy: [
            { user: { lastName: 'asc' } },
            { user: { firstName: 'asc' } },
            { userId: 'asc' },
          ],
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

  private async currencyOf(client: Tx, storeId: string): Promise<string> {
    const store = await client.hardwareStore.findUnique({
      where: { id: storeId },
      select: { country: { select: { currencyCode: true } } },
    });
    if (!store) {
      throw storeNotFound();
    }
    return store.country.currencyCode;
  }
}
