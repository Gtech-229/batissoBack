import { Injectable } from '@nestjs/common';
import { accountNotFound } from '../accounts/accounts.errors.js';
import { formatAmount } from '../common/money.js';
import {
  GoalMovementReason,
  GoalStatus,
  MaterialOrderStatus,
  OperationChannel,
  OperationDirection,
  OperationStatus,
  OperationType,
  OrderConfirmationChannel,
  Prisma,
} from '../generated/prisma/client.js';
import { goalClosed } from '../goals/goals.errors.js';
import { nextGoalState } from '../goals/goal-state.js';
import { formatPurchaseReference } from '../ledger/operation-reference.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { lockStoreNotClosed } from '../store-access/verified-store.js';
import { orderShortfall } from './order-shortfall.js';
import {
  insufficientBalance,
  invalidCode,
  orderKeyReused,
  orderNotFound,
  orderStatusConflict,
} from './orders.errors.js';

type Tx = Prisma.TransactionClient;

/** What a confirmation needs: whose order, how it was confirmed, and the retry key. */
export interface DebitRequest {
  storeId: string;
  accountId: string;
  orderId: string;
  channel: OrderConfirmationChannel;
  /** Who confirmed: the customer (PIN) or the staff entering the SMS code. */
  actorId: string;
  /** The app's deviceId of that session. */
  device: string;
  /** Lowercased UUID from the Idempotency-Key header. */
  idempotencyKey: string;
  /**
   * The SMS code checked for this confirmation: used up in the debit's own
   * transaction, so a refused debit (balance, status) leaves it usable and two
   * entries of one code cannot both debit.
   */
  confirmationCodeId?: string;
}

/**
 * The debit of a confirmed material order (10b): the only place an order moves
 * money. One transaction, in the ledger's lock order: the store row FOR SHARE
 * (a CLOSED store accepts no change; SUSPENDED still serves purchases), then
 * the account row FOR UPDATE (goal balances only change under it), then the
 * order's conditional write. Idempotent like deposits: the key is checked
 * before the locks, under the account lock, and after a P2002.
 */
@Injectable()
export class OrderConfirmationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  /**
   * Debits the order once and marks it CONFIRMED. Returns `replayed: true`
   * when this key already confirmed this order (nothing written again).
   */
  async debit(request: DebitRequest): Promise<{ replayed: boolean }> {
    if (await this.isReplay(this.prisma, request)) {
      return { replayed: true };
    }
    try {
      const { replayed, toNotify } = await this.prisma.$transaction(
        async (tx) => {
          await lockStoreNotClosed(tx, request.storeId);
          const [account] = await tx.$queryRaw<
            { balance: bigint; currencyCode: string }[]
          >`SELECT "balance", "currencyCode" FROM "accounts"
          WHERE "id" = ${request.accountId}::uuid
            AND "storeId" = ${request.storeId}::uuid
          FOR UPDATE`;
          if (!account) {
            throw accountNotFound();
          }
          // Asked again under the lock: a parallel retry waited here for the
          // request that may have just confirmed the order.
          if (await this.isReplay(tx, request)) {
            // Already notified by the request that confirmed it.
            return { replayed: true, toNotify: [] };
          }

          const order = await tx.materialOrder.findFirst({
            where: {
              id: request.orderId,
              accountId: request.accountId,
              storeId: request.storeId,
            },
          });
          if (!order) {
            throw orderNotFound();
          }
          if (order.status !== MaterialOrderStatus.AWAITING_CUSTOMER) {
            throw orderStatusConflict(order.status);
          }
          if (request.confirmationCodeId !== undefined) {
            // The order, then its code: the order ConfirmationCodesService
            // takes them in, so a new code and a confirmation cannot deadlock.
            await tx.$queryRaw`
              SELECT 1 FROM "material_orders"
              WHERE "id" = ${order.id}::uuid FOR UPDATE`;
            const { count } = await tx.orderConfirmationCode.updateMany({
              where: {
                id: request.confirmationCodeId,
                orderId: order.id,
                consumedAt: null,
                expiresAt: { gt: new Date() },
              },
              data: { consumedAt: new Date() },
            });
            if (count === 0) {
              throw invalidCode();
            }
          }

          // Read under the account lock: the balances cannot change meanwhile.
          const goal = await tx.goal.findUniqueOrThrow({
            where: { id: order.goalId },
          });
          if (goal.status === GoalStatus.CLOSED) {
            throw goalClosed();
          }
          const unassigned = goal.isSystem
            ? goal
            : await tx.goal.findFirstOrThrow({
                where: { accountId: request.accountId, isSystem: true },
              });
          const available = goal.isSystem
            ? goal.balance
            : goal.balance + unassigned.balance;
          if (order.total > available) {
            throw insufficientBalance(
              formatAmount(order.total),
              formatAmount(available),
              account.currencyCode,
            );
          }

          // The goal holds less than the total: Unassigned pays the rest, moved
          // into the goal first so the debit is one operation on one goal.
          const shortfall = orderShortfall(
            order.total,
            goal.balance,
            goal.isSystem,
          );
          if (shortfall > 0n) {
            await tx.goalMovement.create({
              data: {
                accountId: request.accountId,
                sourceGoalId: unassigned.id,
                targetGoalId: goal.id,
                amount: shortfall,
                reason: GoalMovementReason.ORDER_SHORTFALL,
                authorId: request.actorId,
                device: request.device,
                orderId: order.id,
              },
            });
            await tx.goal.update({
              where: { id: unassigned.id },
              data: { balance: { decrement: shortfall } },
            });
          }

          const [{ value }] = await tx.$queryRaw<{ value: bigint }[]>`
          SELECT nextval('operation_reference_purchase_seq') AS value`;
          const now = new Date();
          const balanceAfter = account.balance - order.total;
          const operation = await tx.operation.create({
            data: {
              reference: formatPurchaseReference(value),
              accountId: request.accountId,
              storeId: request.storeId,
              goalId: goal.id,
              type: OperationType.MATERIAL_DEBIT,
              amount: order.total,
              direction: OperationDirection.DEBIT,
              currencyCode: account.currencyCode,
              // Computed from the locked row, never from a client value.
              balanceBefore: account.balance,
              balanceAfter,
              status: OperationStatus.CONFIRMED,
              // The staff member who recorded the purchase: the order's preparer.
              authorId: order.createdById,
              validatedById: order.validatedById,
              customerConfirmedAt: now,
              // Paid from the cash saved in the account.
              channel: OperationChannel.CASH,
              idempotencyKey: request.idempotencyKey,
              device: request.device,
            },
            select: { id: true, reference: true },
          });
          await tx.account.update({
            where: { id: request.accountId },
            data: { balance: balanceAfter },
          });
          // A debit only lowers the balance: back below its target, the goal
          // returns to IN_PROGRESS silently (never "just reached").
          const goalBalance = goal.balance + shortfall - order.total;
          const { status, reachedAt } = nextGoalState(goal, goalBalance, now);
          await tx.goal.update({
            where: { id: goal.id },
            data: { balance: goalBalance, status, reachedAt },
          });

          // Conditional, as every order step: a cancellation that won the race
          // leaves nothing to confirm, and the whole debit rolls back.
          const { count } = await tx.materialOrder.updateMany({
            where: {
              id: order.id,
              status: MaterialOrderStatus.AWAITING_CUSTOMER,
            },
            data: {
              status: MaterialOrderStatus.CONFIRMED,
              operationId: operation.id,
              confirmedAt: now,
              confirmedVia: request.channel,
            },
          });
          if (count === 0) {
            const current = await tx.materialOrder.findUniqueOrThrow({
              where: { id: order.id },
              select: { status: true },
            });
            throw orderStatusConflict(current.status);
          }

          // The customer is told of every money movement, in the debit's
          // transaction (sent after the commit).
          const context = await tx.account.findUniqueOrThrow({
            where: { id: request.accountId },
            select: {
              number: true,
              customerId: true,
              store: { select: { name: true } },
            },
          });
          const toNotify = await this.notifications.recordPurchase(tx, {
            customerId: context.customerId,
            storeId: request.storeId,
            storeName: context.store.name,
            accountNumber: context.number,
            operationId: operation.id,
            reference: operation.reference,
            orderReference: order.reference,
            total: order.total,
            currencyCode: account.currencyCode,
            balanceAfter,
          });
          return { replayed: false, toNotify };
        },
      );
      void this.notifications.dispatch(toNotify);
      return { replayed };
    } catch (error) {
      // The same key sent in parallel for another account: the account locks
      // did not serialize the two, so the unique index refused the second
      // insert. The winner decides: the same confirmation, or a reused key.
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002' &&
        (await this.isReplay(this.prisma, request))
      ) {
        return { replayed: true };
      }
      throw error;
    }
  }

  /**
   * True when this key already confirmed this very order; 409
   * IDEMPOTENCY_KEY_REUSED when it recorded anything else; false when new.
   */
  async isReplay(client: Tx, request: DebitRequest): Promise<boolean> {
    const operation = await client.operation.findUnique({
      where: { idempotencyKey: request.idempotencyKey },
      select: {
        materialOrder: { select: { id: true, confirmedVia: true } },
      },
    });
    if (!operation) {
      return false;
    }
    const sameConfirmation =
      operation.materialOrder?.id === request.orderId &&
      operation.materialOrder.confirmedVia === request.channel;
    if (!sameConfirmation) {
      throw orderKeyReused();
    }
    return true;
  }
}
