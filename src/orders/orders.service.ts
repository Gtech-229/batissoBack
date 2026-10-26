import { Injectable } from '@nestjs/common';
import { accountNotFound } from '../accounts/accounts.errors.js';
import {
  articleNotFound,
  articleUnavailable,
} from '../catalogue/catalogue.errors.js';
import { formatAmount } from '../common/money.js';
import {
  ONE_SNAPSHOT,
  paginated,
  toSkipTake,
  type Paginated,
} from '../common/pagination.js';
import {
  GoalStatus,
  MaterialOrderStatus,
  StoreMemberRole,
  type Prisma,
} from '../generated/prisma/client.js';
import { goalClosed, goalNotFound } from '../goals/goals.errors.js';
import type { AuthenticatedUser } from '../mobile-auth/authenticated-user.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type { CurrentStoreContext } from '../store-access/current-store.js';
import { lockStoreNotClosed } from '../store-access/verified-store.js';
import { invalidFields } from '../stores/stores.errors.js';
import {
  ORDER_INCLUDE,
  toOrderView,
  type OrderView,
} from './dto/order-view.js';
import type {
  CancelOrderDto,
  RefuseOrderDto,
} from './dto/order-decisions.dto.js';
import type {
  ListMyOrdersQueryDto,
  ListOrdersQueryDto,
} from './dto/list-orders.dto.js';
import {
  MY_ORDER_INCLUDE,
  toMyOrderView,
  type MyOrderView,
} from './dto/my-order-view.js';
import type { PrepareOrderDto } from './dto/prepare-order.dto.js';
import { formatOrderReference } from './order-reference.js';
import { preparedOrderState } from './order-status.js';
import {
  insufficientBalance,
  notOrderPreparer,
  orderNotFound,
  orderStatusConflict,
  ownAccountOrder,
} from './orders.errors.js';

type Tx = Prisma.TransactionClient;

/** Newest first; id breaks ties within one millisecond (uuid v7 is time-ordered). */
const ORDERS_ORDER = [
  { createdAt: 'desc' },
  { id: 'desc' },
] satisfies Prisma.MaterialOrderOrderByWithRelationInput[];

/**
 * Material orders ("bons de sortie", feature 10a). The store always comes from
 * the guard's context, never from a body; every query filters by it. No money
 * moves here: the customer's confirmation and the debit are 10b.
 */
@Injectable()
export class OrdersService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Prepares an order: lines frozen at today's prices, names, and units; the
   * total checked against what the chosen goal and Unassigned hold (nothing is
   * reserved: the debit checks again under the account lock); the status from
   * the store's validation threshold. One transaction.
   */
  async prepare(
    store: CurrentStoreContext,
    actor: AuthenticatedUser,
    accountId: string,
    dto: PrepareOrderDto,
  ): Promise<OrderView> {
    const articleIds = dto.lines.map((line) => line.articleId);
    const duplicates = articleIds
      .map((id, index) => ({ id, index }))
      .filter(({ id }, index) => articleIds.indexOf(id) !== index);
    if (duplicates.length > 0) {
      throw invalidFields(
        duplicates.map(({ index }) => ({
          field: `lines.${index}.articleId`,
          errors: ['Cet article figure déjà sur une autre ligne du bon'],
        })),
      );
    }

    const orderId = await this.prisma.$transaction(async (tx) => {
      // FOR SHARE: a closing waits for this order (a suspended store still
      // serves purchases; a closed one accepts no change).
      await lockStoreNotClosed(tx, store.storeId);
      const account = await tx.account.findFirst({
        where: { id: accountId, storeId: store.storeId },
        select: { id: true, customerId: true, currencyCode: true },
      });
      if (!account) {
        throw accountNotFound();
      }
      if (account.customerId === actor.userId) {
        throw ownAccountOrder();
      }
      // FOR SHARE: an admin's change to the threshold waits for this order.
      const [settings] = await tx.$queryRaw<{ validationThreshold: bigint }[]>`
        SELECT "validationThreshold" FROM "store_settings"
        WHERE "storeId" = ${store.storeId}::uuid
        FOR SHARE`;

      const { goal, available } = await this.payingGoal(
        tx,
        account.id,
        dto.goalId,
      );
      const lines = await this.frozenLines(tx, store.storeId, dto);
      const total = lines.reduce(
        (sum, line) => sum + BigInt(line.quantity) * line.unitPrice,
        0n,
      );
      if (total > available) {
        throw insufficientBalance(
          formatAmount(total),
          formatAmount(available),
          account.currencyCode,
        );
      }

      const { status, validatedByPreparer } = preparedOrderState(
        total,
        settings.validationThreshold,
        store.role,
      );
      const [{ value }] = await tx.$queryRaw<{ value: bigint }[]>`
        SELECT nextval('material_order_reference_seq') AS value`;
      const order = await tx.materialOrder.create({
        data: {
          reference: formatOrderReference(value),
          storeId: store.storeId,
          accountId: account.id,
          goalId: goal.id,
          status,
          total,
          createdById: actor.userId,
          validatedById: validatedByPreparer ? actor.userId : null,
          validatedAt: validatedByPreparer ? new Date() : null,
          lines: { createMany: { data: lines } },
        },
        select: { id: true },
      });
      return order.id;
    });
    return this.detail(store.storeId, orderId);
  }

  /** The manager validates a seller's order above the threshold: it goes to the customer. */
  async validate(
    store: CurrentStoreContext,
    actor: AuthenticatedUser,
    orderId: string,
  ): Promise<OrderView> {
    await this.transition(
      store,
      orderId,
      [MaterialOrderStatus.AWAITING_VALIDATION],
      {
        status: MaterialOrderStatus.AWAITING_CUSTOMER,
        validatedById: actor.userId,
        validatedAt: new Date(),
      },
    );
    return this.detail(store.storeId, orderId);
  }

  /** The manager refuses a seller's order above the threshold, with a reason. */
  async refuse(
    store: CurrentStoreContext,
    actor: AuthenticatedUser,
    orderId: string,
    dto: RefuseOrderDto,
  ): Promise<OrderView> {
    await this.transition(
      store,
      orderId,
      [MaterialOrderStatus.AWAITING_VALIDATION],
      {
        status: MaterialOrderStatus.REFUSED_BY_MANAGER,
        refusedById: actor.userId,
        refusedAt: new Date(),
        refusalReason: dto.reason,
      },
    );
    return this.detail(store.storeId, orderId);
  }

  /**
   * Cancels an order the customer has not confirmed (user decision,
   * 2026-10-26): its preparer, or the manager, with an optional reason.
   */
  async cancel(
    store: CurrentStoreContext,
    actor: AuthenticatedUser,
    orderId: string,
    dto: CancelOrderDto,
  ): Promise<OrderView> {
    await this.transition(
      store,
      orderId,
      [
        MaterialOrderStatus.AWAITING_VALIDATION,
        MaterialOrderStatus.AWAITING_CUSTOMER,
      ],
      {
        status: MaterialOrderStatus.CANCELLED,
        cancelledById: actor.userId,
        cancelledAt: new Date(),
        cancellationReason: dto.reason ?? null,
      },
      // A seller cancels only the orders they prepared.
      store.role === StoreMemberRole.SELLER ? actor.userId : undefined,
    );
    return this.detail(store.storeId, orderId);
  }

  /** The store's orders, newest first, filtered by status and account. */
  async list(
    storeId: string,
    query: ListOrdersQueryDto,
  ): Promise<Paginated<OrderView>> {
    const where: Prisma.MaterialOrderWhereInput = {
      storeId,
      status: query.status,
      accountId: query.accountId,
    };
    // REPEATABLE READ: the page and the total come from the same snapshot.
    const [orders, total] = await this.prisma.$transaction(
      [
        this.prisma.materialOrder.findMany({
          where,
          include: ORDER_INCLUDE,
          orderBy: ORDERS_ORDER,
          ...toSkipTake(query),
        }),
        this.prisma.materialOrder.count({ where }),
      ],
      ONE_SNAPSHOT,
    );
    return paginated(orders.map(toOrderView), total, query);
  }

  /**
   * The orders of one of the customer's accounts, newest first. The account is
   * looked up with the session user as its customer: anything else is a 404.
   */
  async listMine(
    userId: string,
    accountId: string,
    query: ListMyOrdersQueryDto,
  ): Promise<Paginated<MyOrderView>> {
    await this.ownAccount(userId, accountId);
    const where: Prisma.MaterialOrderWhereInput = {
      accountId,
      status: query.status,
    };
    const [orders, total] = await this.prisma.$transaction(
      [
        this.prisma.materialOrder.findMany({
          where,
          include: MY_ORDER_INCLUDE,
          orderBy: ORDERS_ORDER,
          ...toSkipTake(query),
        }),
        this.prisma.materialOrder.count({ where }),
      ],
      ONE_SNAPSHOT,
    );
    return paginated(orders.map(toMyOrderView), total, query);
  }

  /** One order of one of the customer's accounts; anything else is a 404. */
  async detailMine(
    userId: string,
    accountId: string,
    orderId: string,
  ): Promise<MyOrderView> {
    await this.ownAccount(userId, accountId);
    const order = await this.prisma.materialOrder.findFirst({
      where: { id: orderId, accountId },
      include: MY_ORDER_INCLUDE,
    });
    if (!order) {
      throw orderNotFound();
    }
    return toMyOrderView(order);
  }

  /** One order of this store; another store's order is a 404. */
  async detail(storeId: string, orderId: string): Promise<OrderView> {
    const order = await this.prisma.materialOrder.findFirst({
      where: { id: orderId, storeId },
      include: ORDER_INCLUDE,
    });
    if (!order) {
      throw orderNotFound();
    }
    return toOrderView(order);
  }

  /** The session user's own account, or 404. */
  private async ownAccount(userId: string, accountId: string): Promise<void> {
    const account = await this.prisma.account.findFirst({
      where: { id: accountId, customerId: userId },
      select: { id: true },
    });
    if (!account) {
      throw accountNotFound();
    }
  }

  /**
   * Moves an order of this store from one of `from` to a new status in one
   * conditional write, as for store status changes: of two parallel steps on
   * the same order, the second finds the status changed and changes nothing.
   * A CLOSED store accepts no change. With `preparerId`, only that preparer's
   * order changes. When nothing was written, the answer says why: no such
   * order (404), not its preparer (403), or its status (409).
   */
  private async transition(
    store: CurrentStoreContext,
    orderId: string,
    from: MaterialOrderStatus[],
    data: Prisma.MaterialOrderUncheckedUpdateManyInput,
    preparerId?: string,
  ): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await lockStoreNotClosed(tx, store.storeId);
      const { count } = await tx.materialOrder.updateMany({
        where: {
          id: orderId,
          storeId: store.storeId,
          status: { in: from },
          createdById: preparerId,
        },
        data,
      });
      if (count > 0) {
        return;
      }
      const order = await tx.materialOrder.findFirst({
        where: { id: orderId, storeId: store.storeId },
        select: { status: true, createdById: true },
      });
      if (!order) {
        throw orderNotFound();
      }
      if (preparerId !== undefined && order.createdById !== preparerId) {
        throw notOrderPreparer();
      }
      throw orderStatusConflict(order.status);
    });
  }

  /**
   * The goal paid first (the chosen goal of this account, 404 when it is not
   * one, 409 when closed; or the Unassigned goal) and what can be spent: that
   * goal plus Unassigned, which pays the rest.
   */
  private async payingGoal(
    tx: Tx,
    accountId: string,
    goalId: string | undefined,
  ) {
    const unassigned = await tx.goal.findFirstOrThrow({
      where: { accountId, isSystem: true },
    });
    if (goalId === undefined || goalId === unassigned.id) {
      return { goal: unassigned, available: unassigned.balance };
    }
    const goal = await tx.goal.findFirst({ where: { id: goalId, accountId } });
    if (!goal) {
      throw goalNotFound();
    }
    if (goal.status === GoalStatus.CLOSED) {
      throw goalClosed();
    }
    return { goal, available: goal.balance + unassigned.balance };
  }

  /**
   * The lines with each article's price of the day, name, and unit frozen. An
   * article must be of this store (404) and on sale (409).
   */
  private async frozenLines(tx: Tx, storeId: string, dto: PrepareOrderDto) {
    const articles = await tx.article.findMany({
      where: {
        id: { in: dto.lines.map((line) => line.articleId) },
        storeId,
      },
    });
    const byId = new Map(articles.map((article) => [article.id, article]));
    return dto.lines.map((line) => {
      const article = byId.get(line.articleId);
      if (!article) {
        throw articleNotFound();
      }
      if (!article.available) {
        throw articleUnavailable();
      }
      return {
        articleId: article.id,
        articleName: article.name,
        unit: article.unit,
        quantity: line.quantity,
        unitPrice: article.currentPrice,
      };
    });
  }
}
