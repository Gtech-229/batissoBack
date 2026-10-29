import { Injectable } from '@nestjs/common';
import { accountNotFound } from '../accounts/accounts.errors.js';
import {
  GoalMovementReason,
  GoalStatus,
  MaterialOrderStatus,
  OperationChannel,
  OperationDirection,
  OperationStatus,
  OperationType,
  Prisma,
} from '../generated/prisma/client.js';
import { nextGoalState } from '../goals/goal-state.js';
import { formatCorrectionReference } from '../ledger/operation-reference.js';
import type { AuthenticatedUser } from '../mobile-auth/authenticated-user.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type { CurrentStoreContext } from '../store-access/current-store.js';
import type { CancelPaidOrderDto } from './dto/order-decisions.dto.js';
import { unchangedReason } from './order-unchanged.js';
import { cancellationKeyReused, orderNotFound } from './orders.errors.js';

type Tx = Prisma.TransactionClient;

/** What makes a retry the same cancellation as the one its key recorded. */
interface CancellationRequest {
  storeId: string;
  orderId: string;
  authorId: string;
}

/**
 * The manager cancels a confirmed, undelivered order (11b): the order becomes
 * CANCELLED_AFTER_DEBIT and its purchase debit is re-credited once by a
 * CORRECTION linked to it, the money going back where it came from (user
 * decision, 2026-10-28). The debit itself never changes (append-only).
 *
 * Unlike the debit, no store lock and no closed check: a CLOSED store must
 * still give the money back (user decision). The account row FOR UPDATE
 * serializes every money change on the account, then the order's conditional
 * write decides the race with a delivery before any money moves.
 */
@Injectable()
export class OrderCancellationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  /**
   * Returns `replayed: true` when this key already cancelled this order
   * (nothing written again). Idempotent with the deposit rules: the key is
   * checked before the lock, under it, and after a P2002.
   */
  async cancelAfterDebit(
    store: CurrentStoreContext,
    actor: AuthenticatedUser,
    orderId: string,
    dto: CancelPaidOrderDto,
    idempotencyKey: string,
  ): Promise<{ replayed: boolean }> {
    const request: CancellationRequest = {
      storeId: store.storeId,
      // Lowercase: the replay compares it with the stored id (F-02).
      orderId: orderId.toLowerCase(),
      authorId: actor.userId,
    };
    if (await this.isReplay(this.prisma, idempotencyKey, request)) {
      return { replayed: true };
    }
    // The account to lock: the order's, in this store (404 otherwise).
    const located = await this.prisma.materialOrder.findFirst({
      where: { id: request.orderId, storeId: store.storeId },
      select: { accountId: true },
    });
    if (!located) {
      throw orderNotFound();
    }

    try {
      const { replayed, toNotify } = await this.prisma.$transaction(
        async (tx) => {
          const [account] = await tx.$queryRaw<
            { balance: bigint; currencyCode: string }[]
          >`SELECT "balance", "currencyCode" FROM "accounts"
          WHERE "id" = ${located.accountId}::uuid
            AND "storeId" = ${store.storeId}::uuid
          FOR UPDATE`;
          if (!account) {
            throw accountNotFound();
          }
          // Asked again under the lock: a parallel retry waited here for the
          // request that may have just cancelled the order.
          if (await this.isReplay(tx, idempotencyKey, request)) {
            // Already notified by the request that cancelled it.
            return { replayed: true, toNotify: [] as string[] };
          }

          // First, before any money moves: of a cancellation and a delivery
          // (or two cancellations), only the first to change the status goes on.
          const now = new Date();
          const { count } = await tx.materialOrder.updateMany({
            where: {
              id: request.orderId,
              storeId: store.storeId,
              status: MaterialOrderStatus.CONFIRMED,
            },
            data: {
              status: MaterialOrderStatus.CANCELLED_AFTER_DEBIT,
              cancelledById: actor.userId,
              cancelledAt: now,
              cancellationReason: dto.reason,
            },
          });
          if (count === 0) {
            throw await unchangedReason(tx, store.storeId, request.orderId);
          }

          const order = await tx.materialOrder.findUniqueOrThrow({
            where: { id: request.orderId },
            select: {
              id: true,
              reference: true,
              total: true,
              goalId: true,
              operationId: true,
              goalMovements: {
                // accountId: every movement of the order is on its account, and
                // the account index keeps this read short under the lock (F-15).
                where: {
                  accountId: located.accountId,
                  reason: GoalMovementReason.ORDER_SHORTFALL,
                },
                select: { amount: true },
              },
            },
          });
          // A CONFIRMED order always has its debit (10b).
          const debitId = order.operationId!;
          const shortfall = order.goalMovements.reduce(
            (sum, movement) => sum + movement.amount,
            0n,
          );

          const unassigned = await tx.goal.findFirstOrThrow({
            where: { accountId: located.accountId, isSystem: true },
          });
          const orderGoal = await tx.goal.findUniqueOrThrow({
            where: { id: order.goalId },
          });
          // A goal closed since the debit: its money went back to Unassigned
          // when it was closed, so Unassigned takes the whole credit.
          const goal =
            orderGoal.status === GoalStatus.CLOSED ? unassigned : orderGoal;

          const [{ value }] = await tx.$queryRaw<{ value: bigint }[]>`
          SELECT nextval('operation_reference_correction_seq') AS value`;
          // Computed from the locked row, never from a client value.
          const balanceAfter = account.balance + order.total;
          const recredit = await tx.operation.create({
            data: {
              reference: formatCorrectionReference(value),
              accountId: located.accountId,
              storeId: store.storeId,
              goalId: goal.id,
              type: OperationType.CORRECTION,
              amount: order.total,
              direction: OperationDirection.CREDIT,
              currencyCode: account.currencyCode,
              balanceBefore: account.balance,
              balanceAfter,
              status: OperationStatus.CONFIRMED,
              channel: OperationChannel.CASH,
              correctedOperationId: debitId,
              reason: dto.reason,
              authorId: actor.userId,
              idempotencyKey,
              device: actor.deviceId,
            },
            select: { id: true, reference: true },
          });
          await tx.account.update({
            where: { id: located.accountId },
            data: { balance: balanceAfter },
          });

          // Back where it came from: the goal keeps what it paid, and gives
          // Unassigned back the shortfall Unassigned had covered (10b).
          const givesBack = goal.isSystem ? 0n : shortfall;
          if (givesBack > 0n) {
            await tx.goalMovement.create({
              data: {
                accountId: located.accountId,
                sourceGoalId: goal.id,
                targetGoalId: unassigned.id,
                amount: givesBack,
                reason: GoalMovementReason.ORDER_CANCELLATION,
                authorId: actor.userId,
                device: actor.deviceId,
                orderId: order.id,
              },
            });
            await tx.goal.update({
              where: { id: unassigned.id },
              data: { balance: { increment: givesBack } },
            });
          }
          const goalBalance = goal.balance + order.total - givesBack;
          const state = nextGoalState(goal, goalBalance, now);
          await tx.goal.update({
            where: { id: goal.id },
            data: {
              balance: goalBalance,
              status: state.status,
              reachedAt: state.reachedAt,
            },
          });

          await tx.materialOrder.update({
            where: { id: order.id },
            data: { recreditOperationId: recredit.id },
          });

          // The customer is told of every money movement, in this transaction
          // (sent after the commit).
          const context = await tx.account.findUniqueOrThrow({
            where: { id: located.accountId },
            select: {
              number: true,
              customerId: true,
              store: { select: { name: true } },
            },
          });
          const toNotify = await this.notifications.recordPaidOrderCancelled(
            tx,
            {
              customerId: context.customerId,
              storeId: store.storeId,
              storeName: context.store.name,
              accountNumber: context.number,
              operationId: recredit.id,
              reference: recredit.reference,
              orderReference: order.reference,
              total: order.total,
              currencyCode: account.currencyCode,
              reason: dto.reason,
              balanceAfter,
            },
          );
          // Its money back may take the goal over its target again.
          if (state.justReached) {
            toNotify.push(
              ...(await this.notifications.recordGoalReached(tx, {
                customerId: context.customerId,
                storeId: store.storeId,
                storeName: context.store.name,
                accountNumber: context.number,
                currencyCode: account.currencyCode,
                operationId: recredit.id,
                goal: { ...goal, balance: goalBalance },
              })),
            );
          }
          return { replayed: false, toNotify };
        },
      );
      void this.notifications.dispatch(toNotify);
      return { replayed };
    } catch (error) {
      // The same key sent in parallel for another order: the unique index
      // refused the second insert. The winner decides: the same cancellation,
      // or a reused key.
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002' &&
        (await this.isReplay(this.prisma, idempotencyKey, request))
      ) {
        return { replayed: true };
      }
      throw error;
    }
  }

  /**
   * True when this key already cancelled this order: a CORRECTION re-crediting
   * this order, by the same manager, in this store. False: the key is new.
   * Anything else: 409 IDEMPOTENCY_KEY_REUSED.
   */
  private async isReplay(
    client: Tx,
    idempotencyKey: string,
    request: CancellationRequest,
  ): Promise<boolean> {
    const operation = await client.operation.findUnique({
      where: { idempotencyKey },
      select: {
        type: true,
        storeId: true,
        authorId: true,
        recreditedOrder: { select: { id: true } },
      },
    });
    if (!operation) {
      return false;
    }
    const sameCancellation =
      operation.type === OperationType.CORRECTION &&
      operation.storeId === request.storeId &&
      operation.authorId === request.authorId &&
      operation.recreditedOrder?.id === request.orderId;
    if (!sameCancellation) {
      throw cancellationKeyReused();
    }
    return true;
  }
}
