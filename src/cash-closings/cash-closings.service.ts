import { Injectable } from '@nestjs/common';
import { formatAmount } from '../common/money.js';
import {
  ONE_SNAPSHOT,
  paginated,
  toSkipTake,
  type Paginated,
  type PaginationQueryDto,
} from '../common/pagination.js';
import {
  OperationChannel,
  OperationDirection,
  OperationStatus,
  OperationType,
  Prisma,
} from '../generated/prisma/client.js';
import type { AuthenticatedUser } from '../mobile-auth/authenticated-user.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type { CurrentStoreContext } from '../store-access/current-store.js';
import { storeCurrencyCode } from '../store-access/verified-store.js';
import { storeNotFound } from '../stores/stores.errors.js';
import {
  closingKeyReused,
  closingNotFound,
  justificationRequired,
} from './cash-closings.errors.js';
import { closingTotals } from './closing-totals.js';
import {
  CASH_CLOSING_INCLUDE,
  toCashClosingView,
  type CashClosingView,
  type PendingCashView,
} from './dto/cash-closing-view.js';
import type { CloseCashDto } from './dto/close-cash.dto.js';

type Tx = Prisma.TransactionClient;

export interface ClosingResult {
  closing: CashClosingView;
  /** True when the key had already made this closing: nothing new was written. */
  replayed: boolean;
}

/** What makes a retry the same closing as the one its key made. */
interface ClosingRequest {
  storeId: string;
  managerId: string;
  countedTotal: bigint;
}

/**
 * Daily cash closing (feature 13): the manager counts the cash and records it
 * against what should be there. It covers every cash operation of the store
 * not yet counted, so a skipped day rolls into the next closing. It never
 * moves money, and it is final. The link table, not `createdAt`, is the
 * period's boundary: `createdAt` is a transaction's start, so an operation
 * waiting on the closing's lock would look older than the closing.
 */
@Injectable()
export class CashClosingsService {
  constructor(private readonly prisma: PrismaService) {}

  /** What should be in the drawer now. Reads only. */
  async pending(storeId: string): Promise<PendingCashView> {
    // REPEATABLE READ: the totals and the date come from the same snapshot.
    const [operations, last, currencyCode] = await this.prisma.$transaction(
      async (tx) =>
        [
          await this.uncounted(tx, storeId),
          await tx.cashClosing.findFirst({
            where: { storeId },
            orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
            select: { createdAt: true },
          }),
          await storeCurrencyCode(tx, storeId),
        ] as const,
      ONE_SNAPSHOT,
    );
    const totals = closingTotals(operations);
    return {
      depositsTotal: formatAmount(totals.depositsTotal),
      correctionsTotal: formatAmount(totals.correctionsTotal),
      expectedTotal: formatAmount(totals.expectedTotal),
      currencyCode,
      operationCount: operations.length,
      since: last?.createdAt ?? null,
    };
  }

  /**
   * Closes the cash, in one transaction under the store row FOR UPDATE:
   * deposits and corrections hold it FOR SHARE, so those in flight finish
   * first and new ones wait, and the closing counts a stable set. Any store
   * status: a suspended or closed store still has its last cash to count.
   *
   * Idempotent with the deposit rules: the key is checked before the lock,
   * under it, and after a P2002.
   */
  async close(
    store: CurrentStoreContext,
    actor: AuthenticatedUser,
    dto: CloseCashDto,
    idempotencyKey: string,
  ): Promise<ClosingResult> {
    const countedTotal = BigInt(dto.countedTotal);
    const request: ClosingRequest = {
      storeId: store.storeId,
      managerId: actor.userId,
      countedTotal,
    };
    const earlier = await this.replay(this.prisma, idempotencyKey, request);
    if (earlier) {
      return earlier;
    }

    try {
      return await this.prisma.$transaction(async (tx) => {
        const [row] = await tx.$queryRaw<{ id: string }[]>`
          SELECT "id" FROM "hardware_stores"
          WHERE "id" = ${store.storeId}::uuid
          FOR UPDATE`;
        if (!row) {
          throw storeNotFound();
        }
        // Asked again under the lock: a parallel retry waited here for the
        // request that may have just made this closing.
        const parallel = await this.replay(tx, idempotencyKey, request);
        if (parallel) {
          return parallel;
        }

        const operations = await this.uncounted(tx, store.storeId);
        const totals = closingTotals(operations);
        const discrepancy = countedTotal - totals.expectedTotal;
        const currencyCode = await storeCurrencyCode(tx, store.storeId);
        if (discrepancy !== 0n && dto.justification === undefined) {
          throw justificationRequired(
            formatAmount(totals.expectedTotal),
            formatAmount(discrepancy),
            currencyCode,
          );
        }

        const closing = await tx.cashClosing.create({
          data: {
            storeId: store.storeId,
            managerId: actor.userId,
            currencyCode,
            ...totals,
            countedTotal,
            discrepancy,
            justification: dto.justification,
            idempotencyKey,
            device: actor.deviceId,
          },
          select: { id: true },
        });
        await tx.cashClosingOperation.createMany({
          data: operations.map((operation) => ({
            closingId: closing.id,
            operationId: operation.id,
          })),
        });
        const stored = await tx.cashClosing.findUniqueOrThrow({
          where: { id: closing.id },
          include: CASH_CLOSING_INCLUDE,
        });
        return { closing: toCashClosingView(stored), replayed: false };
      });
    } catch (error) {
      // The same key sent in parallel for another store: the store locks did
      // not serialize the two, so the unique index refused the second insert.
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        const winner = await this.replay(this.prisma, idempotencyKey, request);
        if (winner) {
          return winner;
        }
      }
      throw error;
    }
  }

  /** The store's closings, newest first. */
  async list(
    storeId: string,
    query: PaginationQueryDto,
  ): Promise<Paginated<CashClosingView>> {
    // REPEATABLE READ: the page and the total come from the same snapshot.
    const [closings, total] = await this.prisma.$transaction(
      [
        this.prisma.cashClosing.findMany({
          where: { storeId },
          include: CASH_CLOSING_INCLUDE,
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          ...toSkipTake(query),
        }),
        this.prisma.cashClosing.count({ where: { storeId } }),
      ],
      ONE_SNAPSHOT,
    );
    return paginated(closings.map(toCashClosingView), total, query);
  }

  /** One closing of this store; another store's is a 404. */
  async detail(storeId: string, closingId: string): Promise<CashClosingView> {
    const closing = await this.prisma.cashClosing.findFirst({
      where: { id: closingId, storeId },
      include: CASH_CLOSING_INCLUDE,
    });
    if (!closing) {
      throw closingNotFound();
    }
    return toCashClosingView(closing);
  }

  /**
   * The store's cash operations no closing has counted: deposits, and the
   * corrections that take a deposit back. Purchases and re-credits move
   * savings, not cash, so they are never counted.
   */
  private uncounted(client: Tx, storeId: string) {
    return client.operation.findMany({
      where: {
        storeId,
        status: OperationStatus.CONFIRMED,
        channel: OperationChannel.CASH,
        cashClosing: { is: null },
        OR: [
          { type: OperationType.DEPOSIT },
          {
            type: OperationType.CORRECTION,
            direction: OperationDirection.DEBIT,
          },
        ],
      },
      select: { id: true, type: true, amount: true },
    });
  }

  /**
   * The closing this key already made, if any. Null: the key is new. The same
   * store, manager, and count: that closing. Anything else: 409
   * IDEMPOTENCY_KEY_REUSED.
   */
  private async replay(
    client: Tx,
    idempotencyKey: string,
    request: ClosingRequest,
  ): Promise<ClosingResult | null> {
    const closing = await client.cashClosing.findUnique({
      where: { idempotencyKey },
      include: CASH_CLOSING_INCLUDE,
    });
    if (!closing) {
      return null;
    }
    const sameClosing =
      closing.storeId === request.storeId &&
      closing.managerId === request.managerId &&
      closing.countedTotal === request.countedTotal;
    if (!sameClosing) {
      throw closingKeyReused();
    }
    return { closing: toCashClosingView(closing), replayed: true };
  }
}
