import { Injectable } from '@nestjs/common';
import { ONE_SNAPSHOT } from '../common/pagination.js';
import { StoreStatus, type Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type { ReportPeriodDto } from '../store-reports/dto/report-period.dto.js';
import {
  MAX_PERIOD_DAYS,
  periodRange,
  type PeriodRange,
} from '../store-reports/period-range.js';
import { invalidFields } from '../stores/stores.errors.js';
import { subscriptionStateWhere } from '../subscriptions/store-subscription.js';
import {
  SUBSCRIPTION_STATES,
  type SubscriptionState,
} from '../subscriptions/subscription-status.js';
import type {
  CountryFigures,
  Figures,
  PlatformStats,
} from './dto/platform-stats.dto.js';

type Tx = Prisma.TransactionClient;

/** All zero: a country gets a figure only where something happened. */
function emptyFigures(): Figures {
  return {
    stores: {
      byStatus: { PENDING: 0, VERIFIED: 0, SUSPENDED: 0, CLOSED: 0 },
      bySubscription: { ACTIVE: 0, UPCOMING: 0, EXPIRED: 0, NONE: 0 },
      registered: 0,
    },
    accounts: { total: 0, suspended: 0, opened: 0, active: 0 },
    trust: {
      disputesOpened: 0,
      disputesUnresolved: 0,
      corrections: 0,
      ordersRefused: 0,
      closingsWithDiscrepancy: 0,
    },
  };
}

/** Adds `from` into `into`, figure by figure: the platform is the countries' sum. */
function addInto(into: Figures, from: Figures): void {
  for (const status of Object.values(StoreStatus)) {
    into.stores.byStatus[status] += from.stores.byStatus[status];
  }
  for (const state of SUBSCRIPTION_STATES) {
    into.stores.bySubscription[state] += from.stores.bySubscription[state];
  }
  into.stores.registered += from.stores.registered;
  into.accounts.total += from.accounts.total;
  into.accounts.suspended += from.accounts.suspended;
  into.accounts.opened += from.accounts.opened;
  into.accounts.active += from.accounts.active;
  for (const key of Object.keys(into.trust) as (keyof Figures['trust'])[]) {
    into.trust[key] += from.trust[key];
  }
}

/**
 * The platform's figures for admins (16d): counts only, per country and in
 * total, over a period of days. Every count is grouped by country in SQL,
 * inside one snapshot, so the blocks agree with each other.
 */
@Injectable()
export class StatsService {
  constructor(private readonly prisma: PrismaService) {}

  async stats(period: ReportPeriodDto): Promise<PlatformStats> {
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

    const countries = await this.prisma.$transaction(
      (tx) => this.countries(tx, range),
      ONE_SNAPSHOT,
    );

    const platform = emptyFigures();
    for (const country of countries) {
      addInto(platform, country);
    }
    return {
      period: { from: period.from, to: period.to },
      platform,
      countries,
    };
  }

  /** One block per country with at least one store, by code. */
  private async countries(
    tx: Tx,
    range: PeriodRange,
  ): Promise<CountryFigures[]> {
    const withStores = await tx.country.findMany({
      where: { stores: { some: {} } },
      select: { code: true, name: true },
      orderBy: { code: 'asc' },
    });
    const byCode = new Map<string, CountryFigures>(
      withStores.map((c) => {
        const { stores, accounts, trust } = emptyFigures();
        return [
          c.code,
          { countryCode: c.code, name: c.name, stores, accounts, trust },
        ];
      }),
    );
    const of = (code: string) => byCode.get(code);

    for (const row of await tx.hardwareStore.groupBy({
      by: ['countryCode', 'status'],
      _count: { _all: true },
    })) {
      const country = of(row.countryCode);
      if (country) {
        country.stores.byStatus[row.status] = row._count._all;
      }
    }

    for (const state of SUBSCRIPTION_STATES) {
      await this.countSubscriptionState(tx, state, of);
    }

    for (const row of await tx.hardwareStore.groupBy({
      by: ['countryCode'],
      where: { createdAt: { gte: range.start, lt: range.end } },
      _count: { _all: true },
    })) {
      const country = of(row.countryCode);
      if (country) {
        country.stores.registered = row._count._all;
      }
    }

    // Accounts are counted in their store's country: a join, so in SQL.
    const accounts = await tx.$queryRaw<
      {
        countryCode: string;
        total: bigint;
        suspended: bigint;
        opened: bigint;
        active: bigint;
      }[]
    >`
      SELECT s."countryCode",
        COUNT(*) AS "total",
        COUNT(*) FILTER (WHERE a."status" = 'SUSPENDED') AS "suspended",
        COUNT(*) FILTER (
          WHERE a."createdAt" >= ${range.start} AND a."createdAt" < ${range.end}
        ) AS "opened",
        COUNT(*) FILTER (WHERE EXISTS (
          SELECT 1 FROM "operations" o
          WHERE o."accountId" = a."id"
            AND o."type" = 'DEPOSIT' AND o."status" = 'CONFIRMED'
            AND o."createdAt" >= ${range.start} AND o."createdAt" < ${range.end}
        )) AS "active"
      FROM "accounts" a
      JOIN "hardware_stores" s ON s."id" = a."storeId"
      GROUP BY s."countryCode"`;
    for (const row of accounts) {
      const country = of(row.countryCode);
      if (country) {
        country.accounts = {
          total: Number(row.total),
          suspended: Number(row.suspended),
          opened: Number(row.opened),
          active: Number(row.active),
        };
      }
    }

    await this.countTrust(tx, range, of);

    return [...byCode.values()];
  }

  /**
   * The trust signals, each counted in its store's country: one grouped query
   * per table. An order counts as refused on the day it was refused, by the
   * manager (`refusedAt`) or by the customer (`customerRefusedAt`).
   */
  private async countTrust(
    tx: Tx,
    { start, end }: PeriodRange,
    of: (code: string) => CountryFigures | undefined,
  ): Promise<void> {
    const disputes = await tx.$queryRaw<
      { countryCode: string; opened: bigint; unresolved: bigint }[]
    >`
      SELECT s."countryCode",
        COUNT(*) FILTER (WHERE d."createdAt" >= ${start} AND d."createdAt" < ${end}) AS "opened",
        COUNT(*) FILTER (WHERE d."status" IN ('OPEN', 'ANSWERED')) AS "unresolved"
      FROM "disputes" d
      JOIN "hardware_stores" s ON s."id" = d."storeId"
      GROUP BY s."countryCode"`;
    for (const row of disputes) {
      const country = of(row.countryCode);
      if (country) {
        country.trust.disputesOpened = Number(row.opened);
        country.trust.disputesUnresolved = Number(row.unresolved);
      }
    }

    const counted = await tx.$queryRaw<
      { countryCode: string; signal: string; count: bigint }[]
    >`
      SELECT s."countryCode", 'corrections' AS "signal", COUNT(*) AS "count"
      FROM "operations" o
      JOIN "hardware_stores" s ON s."id" = o."storeId"
      WHERE o."type" = 'CORRECTION' AND o."status" = 'CONFIRMED'
        AND o."createdAt" >= ${start} AND o."createdAt" < ${end}
      GROUP BY s."countryCode"
      UNION ALL
      SELECT s."countryCode", 'ordersRefused', COUNT(*)
      FROM "material_orders" m
      JOIN "hardware_stores" s ON s."id" = m."storeId"
      WHERE (m."refusedAt" >= ${start} AND m."refusedAt" < ${end})
         OR (m."customerRefusedAt" >= ${start} AND m."customerRefusedAt" < ${end})
      GROUP BY s."countryCode"
      UNION ALL
      SELECT s."countryCode", 'closingsWithDiscrepancy', COUNT(*)
      FROM "cash_closings" c
      JOIN "hardware_stores" s ON s."id" = c."storeId"
      WHERE c."discrepancy" <> 0
        AND c."createdAt" >= ${start} AND c."createdAt" < ${end}
      GROUP BY s."countryCode"`;
    for (const row of counted) {
      const country = of(row.countryCode);
      const signal = row.signal as
        'corrections' | 'ordersRefused' | 'closingsWithDiscrepancy';
      if (country) {
        country.trust[signal] = Number(row.count);
      }
    }
  }

  /** The 16a filter for a state, grouped by country. */
  private async countSubscriptionState(
    tx: Tx,
    state: SubscriptionState,
    of: (code: string) => CountryFigures | undefined,
  ): Promise<void> {
    for (const row of await tx.hardwareStore.groupBy({
      by: ['countryCode'],
      where: subscriptionStateWhere(state),
      _count: { _all: true },
    })) {
      const country = of(row.countryCode);
      if (country) {
        country.stores.bySubscription[state] = row._count._all;
      }
    }
  }
}
