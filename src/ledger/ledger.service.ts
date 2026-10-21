import { Injectable } from '@nestjs/common';
import { accountNotFound } from '../accounts/accounts.errors.js';
import { formatAmount, parseAmount } from '../common/money.js';
import {
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
import { NotificationsService } from '../notifications/notifications.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type { CurrentStoreContext } from '../store-access/current-store.js';
import { lockVerifiedStore } from '../store-access/verified-store.js';
import {
  RECEIPT_INCLUDE,
  toOperationReceipt,
  type OperationReceipt,
} from './dto/operation-receipt.js';
import type { RecordDepositDto } from './dto/record-deposit.dto.js';
import {
  belowMinDeposit,
  DEPOSIT_REFUSAL,
  idempotencyKeyReused,
  maxBalanceExceeded,
  operationNotFound,
  ownAccountDeposit,
} from './ledger.errors.js';
import { formatDepositReference } from './operation-reference.js';

export interface DepositResult {
  receipt: OperationReceipt;
  /** True when the key had already recorded this deposit: nothing new was written. */
  replayed: boolean;
}

/** What makes a retry the same deposit as the one its key recorded. */
interface DepositRequest {
  storeId: string;
  accountId: string;
  amount: bigint;
  authorId: string;
}

/**
 * The ledger: operations are the source of truth, balances are projections
 * changed in the same transaction. Lock order, always: the store row
 * (`FOR SHARE`), then the account row (`FOR UPDATE`). Every money-moving
 * feature takes them in this order, so two transactions never wait on each
 * other in reverse.
 */
@Injectable()
export class LedgerService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  /**
   * Records cash handed over at the counter, in one transaction: the store
   * must be verified, the limits hold, the operation is inserted with the
   * balance before and after, and the account and its Unassigned goal gain
   * the amount.
   *
   * Idempotent: the app sends one key per deposit and the same key again when
   * it retries (a lost answer, a timeout). A key that already recorded this
   * deposit gives back its receipt and writes nothing; a key that recorded
   * anything else is refused.
   */
  async deposit(
    store: CurrentStoreContext,
    actor: AuthenticatedUser,
    accountId: string,
    dto: RecordDepositDto,
    idempotencyKey: string,
  ): Promise<DepositResult> {
    const amount = parseAmount(dto.amount);
    const request: DepositRequest = {
      storeId: store.storeId,
      accountId,
      amount,
      authorId: actor.userId,
    };

    // A retry of a recorded deposit gets its receipt, whatever changed since
    // (store suspended, maximum reached): the money is already in.
    const earlier = await this.replay(this.prisma, idempotencyKey, request);
    if (earlier) {
      return earlier;
    }

    try {
      const { result, toNotify } = await this.prisma.$transaction(
        async (tx) => {
          await lockVerifiedStore(tx, store.storeId, DEPOSIT_REFUSAL);

          // FOR UPDATE: deposits on one account run one after the other, so each
          // reads the balance the previous one wrote.
          const [account] = await tx.$queryRaw<
            { customerId: string; balance: bigint; currencyCode: string }[]
          >`SELECT "customerId", "balance", "currencyCode" FROM "accounts"
          WHERE "id" = ${accountId}::uuid AND "storeId" = ${store.storeId}::uuid
          FOR UPDATE`;
          if (!account) {
            throw accountNotFound();
          }

          // Asked again under the lock: a retry sent in parallel waited here for
          // the first request, which may have just recorded the deposit.
          const parallel = await this.replay(tx, idempotencyKey, request);
          if (parallel) {
            // Already notified by the request that recorded it.
            return { result: parallel, toNotify: [] };
          }

          if (account.customerId === actor.userId) {
            throw ownAccountDeposit();
          }

          // FOR SHARE: an admin's change to the limits waits for this deposit.
          const [settings] = await tx.$queryRaw<
            { minDeposit: bigint; maxBalance: bigint }[]
          >`SELECT "minDeposit", "maxBalance" FROM "store_settings"
          WHERE "storeId" = ${store.storeId}::uuid
          FOR SHARE`;
          const currency = account.currencyCode;
          if (amount < settings.minDeposit) {
            throw belowMinDeposit(formatAmount(settings.minDeposit), currency);
          }
          // Computed from the locked row, never from a client value.
          const balanceAfter = account.balance + amount;
          if (balanceAfter > settings.maxBalance) {
            const room = settings.maxBalance - account.balance;
            throw maxBalanceExceeded(
              formatAmount(settings.maxBalance),
              formatAmount(room > 0n ? room : 0n),
              currency,
            );
          }

          // Every deposit goes to the Unassigned goal until feature 8.
          const goal = await tx.goal.findFirstOrThrow({
            where: { accountId, isSystem: true },
            select: { id: true },
          });
          const [{ value }] = await tx.$queryRaw<{ value: bigint }[]>`
          SELECT nextval('operation_reference_deposit_seq') AS value
        `;

          const operation = await tx.operation.create({
            data: {
              reference: formatDepositReference(value),
              accountId,
              storeId: store.storeId,
              goalId: goal.id,
              type: OperationType.DEPOSIT,
              amount,
              direction: OperationDirection.CREDIT,
              currencyCode: currency,
              balanceBefore: account.balance,
              balanceAfter,
              // The cash is in hand: confirmed at once.
              status: OperationStatus.CONFIRMED,
              channel: OperationChannel.CASH,
              authorId: actor.userId,
              idempotencyKey,
              device: actor.deviceId,
            },
            include: RECEIPT_INCLUDE,
          });
          await tx.account.update({
            where: { id: accountId },
            data: { balance: balanceAfter },
          });
          await tx.goal.update({
            where: { id: goal.id },
            data: { balance: { increment: amount } },
          });
          // In this transaction: the deposit and its notifications commit, or
          // roll back, together.
          const notificationIds = await this.notifications.recordDeposit(
            tx,
            operation,
          );
          return {
            result: { receipt: toOperationReceipt(operation), replayed: false },
            toNotify: notificationIds,
          };
        },
      );
      // After the commit, without waiting: the answer never depends on an SMS
      // or push provider (dispatch never throws).
      void this.notifications.dispatch(toNotify);
      return result;
    } catch (error) {
      // The same key sent in parallel for another account: the account locks
      // did not serialize the two, so the unique index refused the second
      // insert. The winner decides: the same deposit, or a reused key.
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

  /**
   * An account's operations, newest first, as receipts. The account is looked
   * up with the guard's store, so another store's account is a 404. Readable in
   * every store status.
   */
  async history(
    storeId: string,
    accountId: string,
    query: PaginationQueryDto,
  ): Promise<Paginated<OperationReceipt>> {
    const account = await this.prisma.account.findFirst({
      where: { id: accountId, storeId },
      select: { id: true },
    });
    if (!account) {
      throw accountNotFound();
    }
    return this.operationsOf({ accountId }, query);
  }

  /**
   * The signed-in customer's own account history. The user comes from the
   * session: any account that is not theirs is a 404 (never a 403, so account
   * ids cannot be probed), in every store.
   */
  async myHistory(
    userId: string,
    accountId: string,
    query: PaginationQueryDto,
  ): Promise<Paginated<OperationReceipt>> {
    const account = await this.prisma.account.findFirst({
      where: { id: accountId, customerId: userId },
      select: { id: true },
    });
    if (!account) {
      throw accountNotFound();
    }
    return this.operationsOf({ accountId }, query);
  }

  /** One operation of the signed-in customer's own account: its receipt. */
  async myReceipt(
    userId: string,
    accountId: string,
    operationId: string,
  ): Promise<OperationReceipt> {
    return this.receiptWhere({
      id: operationId,
      accountId,
      account: { customerId: userId },
    });
  }

  /** One operation of this store's account: its receipt. */
  async receipt(
    storeId: string,
    accountId: string,
    operationId: string,
  ): Promise<OperationReceipt> {
    return this.receiptWhere({ id: operationId, accountId, storeId });
  }

  /** A page of operations, newest first; the total from the same snapshot. */
  async operationsOf(
    where: Prisma.OperationWhereInput,
    query: PaginationQueryDto,
  ): Promise<Paginated<OperationReceipt>> {
    const [operations, total] = await this.prisma.$transaction([
      this.prisma.operation.findMany({
        where,
        include: RECEIPT_INCLUDE,
        // id breaks ties within one millisecond (uuid v7 is time-ordered).
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        ...toSkipTake(query),
      }),
      this.prisma.operation.count({ where }),
    ]);
    return paginated(operations.map(toOperationReceipt), total, query);
  }

  /** The one operation matching `where`, or 404 `Opération introuvable`. */
  async receiptWhere(
    where: Prisma.OperationWhereInput,
  ): Promise<OperationReceipt> {
    const operation = await this.prisma.operation.findFirst({
      where,
      include: RECEIPT_INCLUDE,
    });
    if (!operation) {
      throw operationNotFound();
    }
    return toOperationReceipt(operation);
  }

  /**
   * The deposit this key already recorded, if any. Null: the key is new. The
   * same store, account, amount, and author: that deposit's receipt. Anything
   * else: 409 IDEMPOTENCY_KEY_REUSED.
   */
  private async replay(
    client: Prisma.TransactionClient,
    idempotencyKey: string,
    request: DepositRequest,
  ): Promise<DepositResult | null> {
    const operation = await client.operation.findUnique({
      where: { idempotencyKey },
      include: RECEIPT_INCLUDE,
    });
    if (!operation) {
      return null;
    }
    const sameDeposit =
      operation.type === OperationType.DEPOSIT &&
      operation.storeId === request.storeId &&
      operation.accountId === request.accountId &&
      operation.amount === request.amount &&
      operation.authorId === request.authorId;
    if (!sameDeposit) {
      throw idempotencyKeyReused();
    }
    return { receipt: toOperationReceipt(operation), replayed: true };
  }
}
