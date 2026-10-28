import { Injectable } from '@nestjs/common';
import { accountNotFound } from '../accounts/accounts.errors.js';
import { formatAmount, parseAmount } from '../common/money.js';
import {
  GoalMovementReason,
  GoalStatus,
  OperationChannel,
  OperationDirection,
  OperationStatus,
  OperationType,
  Prisma,
} from '../generated/prisma/client.js';
import { nextGoalState } from '../goals/goal-state.js';
import type { AuthenticatedUser } from '../mobile-auth/authenticated-user.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { orderShortfall } from '../orders/order-shortfall.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type { CurrentStoreContext } from '../store-access/current-store.js';
import { lockStoreNotClosed } from '../store-access/verified-store.js';
import {
  RECEIPT_INCLUDE,
  toOperationReceipt,
  type OperationReceipt,
} from './dto/operation-receipt.js';
import type { RecordCorrectionDto } from './dto/record-correction.dto.js';
import {
  correctionExceedsDeposit,
  idempotencyKeyReused,
  insufficientBalanceForCorrection,
  notCorrectable,
  operationNotFound,
  ownAccountCorrection,
} from './ledger.errors.js';
import { formatCorrectionReference } from './operation-reference.js';

export interface CorrectionResult {
  receipt: OperationReceipt;
  /** True when the key had already recorded this correction: nothing new was written. */
  replayed: boolean;
}

/** What makes a retry the same correction as the one its key recorded. */
interface CorrectionRequest {
  storeId: string;
  accountId: string;
  /** The deposit corrected. */
  operationId: string;
  amount: bigint;
  authorId: string;
}

/**
 * A manager's correction of a deposit recorded too high (11a): a new
 * CORRECTION operation that takes the amount back, linked to the deposit, with
 * a reason. The deposit itself never changes (the ledger is append-only).
 */
@Injectable()
export class CorrectionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  /**
   * In one transaction, in the ledger's lock order (store, then account): the
   * deposit must be of this account, the corrections of it never add up to
   * more than its amount, and the money is taken from the deposit's goal,
   * then from Unassigned (user decision, 2026-10-27).
   *
   * Idempotent with the deposit rules: the same key for the same correction
   * gives back its receipt and writes nothing; for anything else, 409.
   */
  async correct(
    store: CurrentStoreContext,
    actor: AuthenticatedUser,
    accountId: string,
    operationId: string,
    dto: RecordCorrectionDto,
    idempotencyKey: string,
  ): Promise<CorrectionResult> {
    const amount = parseAmount(dto.amount);
    const request: CorrectionRequest = {
      storeId: store.storeId,
      // Lowercase: the replay compares them with stored ids (F-02).
      accountId: accountId.toLowerCase(),
      operationId: operationId.toLowerCase(),
      amount,
      authorId: actor.userId,
    };

    const earlier = await this.replay(this.prisma, idempotencyKey, request);
    if (earlier) {
      return earlier;
    }

    try {
      const { result, toNotify } = await this.prisma.$transaction(
        async (tx) => {
          // A closed store changes nothing; a suspended one still fixes errors.
          await lockStoreNotClosed(tx, store.storeId);

          // FOR UPDATE: every operation on this account waits here, so the
          // balance and the deposit's corrections cannot change meanwhile.
          const [account] = await tx.$queryRaw<
            { customerId: string; balance: bigint; currencyCode: string }[]
          >`SELECT "customerId", "balance", "currencyCode" FROM "accounts"
          WHERE "id" = ${request.accountId}::uuid AND "storeId" = ${store.storeId}::uuid
          FOR UPDATE`;
          if (!account) {
            throw accountNotFound();
          }

          // Asked again under the lock: a retry sent in parallel waited here
          // for the first request, which may have just recorded it.
          const parallel = await this.replay(tx, idempotencyKey, request);
          if (parallel) {
            // Already notified by the request that recorded it.
            return { result: parallel, toNotify: [] };
          }

          if (account.customerId === actor.userId) {
            throw ownAccountCorrection();
          }

          const deposit = await tx.operation.findFirst({
            where: {
              id: request.operationId,
              accountId: request.accountId,
              storeId: store.storeId,
            },
            select: {
              id: true,
              type: true,
              amount: true,
              reference: true,
              goalId: true,
            },
          });
          if (!deposit) {
            throw operationNotFound();
          }
          if (deposit.type !== OperationType.DEPOSIT) {
            throw notCorrectable();
          }
          const {
            _sum: { amount: corrected },
          } = await tx.operation.aggregate({
            // accountId: every correction of this deposit is on its account,
            // and the account index keeps this read short under the lock (F-13).
            where: {
              accountId: request.accountId,
              correctedOperationId: deposit.id,
            },
            _sum: { amount: true },
          });
          const remaining = deposit.amount - (corrected ?? 0n);
          const currency = account.currencyCode;
          if (amount > remaining) {
            throw correctionExceedsDeposit(
              formatAmount(remaining),
              currency,
              deposit.reference,
            );
          }

          // The deposit's goal pays first. A closed goal's money already went
          // back to Unassigned when it was closed, so Unassigned pays it all.
          const unassigned = await tx.goal.findFirstOrThrow({
            where: { accountId: request.accountId, isSystem: true },
          });
          const depositGoal = await tx.goal.findUniqueOrThrow({
            where: { id: deposit.goalId },
          });
          const goal =
            depositGoal.status === GoalStatus.CLOSED ? unassigned : depositGoal;
          const available = goal.isSystem
            ? goal.balance
            : goal.balance + unassigned.balance;
          if (amount > available) {
            throw insufficientBalanceForCorrection(
              formatAmount(available),
              currency,
            );
          }

          // The goal holds less: Unassigned pays the rest, moved into the goal
          // first so the correction is one operation on one goal.
          const shortfall = orderShortfall(amount, goal.balance, goal.isSystem);
          if (shortfall > 0n) {
            await tx.goalMovement.create({
              data: {
                accountId: request.accountId,
                sourceGoalId: unassigned.id,
                targetGoalId: goal.id,
                amount: shortfall,
                reason: GoalMovementReason.CORRECTION_SHORTFALL,
                authorId: actor.userId,
                device: actor.deviceId,
              },
            });
            await tx.goal.update({
              where: { id: unassigned.id },
              data: { balance: { decrement: shortfall } },
            });
          }

          const [{ value }] = await tx.$queryRaw<{ value: bigint }[]>`
          SELECT nextval('operation_reference_correction_seq') AS value`;
          // Computed from the locked row, never from a client value.
          const balanceAfter = account.balance - amount;
          const operation = await tx.operation.create({
            data: {
              reference: formatCorrectionReference(value),
              accountId: request.accountId,
              storeId: store.storeId,
              goalId: goal.id,
              type: OperationType.CORRECTION,
              amount,
              direction: OperationDirection.DEBIT,
              currencyCode: currency,
              balanceBefore: account.balance,
              balanceAfter,
              status: OperationStatus.CONFIRMED,
              channel: OperationChannel.CASH,
              correctedOperationId: deposit.id,
              reason: dto.reason,
              authorId: actor.userId,
              idempotencyKey,
              device: actor.deviceId,
            },
            include: RECEIPT_INCLUDE,
          });
          await tx.account.update({
            where: { id: request.accountId },
            data: { balance: balanceAfter },
          });
          // Back below its target, the goal returns to IN_PROGRESS silently.
          const goalBalance = goal.balance + shortfall - amount;
          const state = nextGoalState(goal, goalBalance);
          await tx.goal.update({
            where: { id: goal.id },
            data: {
              balance: goalBalance,
              status: state.status,
              reachedAt: state.reachedAt,
            },
          });
          // In this transaction: the correction and its notifications commit,
          // or roll back, together (sent after the commit).
          return {
            result: { receipt: toOperationReceipt(operation), replayed: false },
            toNotify: await this.notifications.recordCorrection(tx, operation),
          };
        },
      );
      void this.notifications.dispatch(toNotify);
      return result;
    } catch (error) {
      // The same key sent in parallel for another account: the unique index
      // refused the second insert. The winner decides: the same correction,
      // or a reused key.
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
   * The correction this key already recorded, if any. Null: the key is new.
   * The same store, account, deposit, amount, and author: its receipt.
   * Anything else: 409 IDEMPOTENCY_KEY_REUSED.
   */
  private async replay(
    client: Prisma.TransactionClient,
    idempotencyKey: string,
    request: CorrectionRequest,
  ): Promise<CorrectionResult | null> {
    const operation = await client.operation.findUnique({
      where: { idempotencyKey },
      include: RECEIPT_INCLUDE,
    });
    if (!operation) {
      return null;
    }
    const sameCorrection =
      operation.type === OperationType.CORRECTION &&
      // A deposit correction is always a DEBIT: a CREDIT is a paid order's
      // re-credit (11b), never a replay of this route (F-13).
      operation.direction === OperationDirection.DEBIT &&
      operation.storeId === request.storeId &&
      operation.accountId === request.accountId &&
      operation.correctedOperationId === request.operationId &&
      operation.amount === request.amount &&
      operation.authorId === request.authorId;
    if (!sameCorrection) {
      throw idempotencyKeyReused();
    }
    return { receipt: toOperationReceipt(operation), replayed: true };
  }
}
