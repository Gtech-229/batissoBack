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
  OrderConfirmationChannel,
  StoreMemberRole,
  type Prisma,
} from '../generated/prisma/client.js';
import { goalClosed, goalNotFound } from '../goals/goals.errors.js';
import type { AuthenticatedUser } from '../mobile-auth/authenticated-user.js';
import { PinCheck } from '../mobile-auth/pin-check.service.js';
import { NotificationsService } from '../notifications/notifications.service.js';
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
  CustomerRefusalDto,
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
import { OrderConfirmationService } from './order-confirmation.service.js';
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
  constructor(
    private readonly prisma: PrismaService,
    private readonly pinCheck: PinCheck,
    private readonly confirmation: OrderConfirmationService,
    private readonly notifications: NotificationsService,
  ) {}

  /**
   * The customer refuses an order awaiting them (10b): one conditional write,
   * and an alert to the store's active managers recorded in the same
   * transaction (sent after the commit). A CLOSED store accepts no change.
   */
  async refuseMine(
    userId: string,
    accountId: string,
    orderId: string,
    dto: CustomerRefusalDto,
  ): Promise<MyOrderView> {
    const account = await this.prisma.account.findFirst({
      where: { id: accountId, customerId: userId },
      select: { id: true, storeId: true, number: true, currencyCode: true },
    });
    if (!account) {
      throw accountNotFound();
    }
    const toNotify = await this.prisma.$transaction(async (tx) => {
      await lockStoreNotClosed(tx, account.storeId);
      const { count } = await tx.materialOrder.updateMany({
        where: {
          id: orderId,
          accountId: account.id,
          status: MaterialOrderStatus.AWAITING_CUSTOMER,
        },
        data: {
          status: MaterialOrderStatus.REFUSED_BY_CUSTOMER,
          customerRefusedAt: new Date(),
          customerRefusalReason: dto.reason ?? null,
        },
      });
      const order = await tx.materialOrder.findFirst({
        where: { id: orderId, accountId: account.id },
        select: { status: true, reference: true, total: true },
      });
      if (!order) {
        throw orderNotFound();
      }
      if (count === 0) {
        throw orderStatusConflict(order.status);
      }
      return this.notifications.recordOrderRefusedByCustomer(tx, {
        storeId: account.storeId,
        reference: order.reference,
        total: order.total,
        currencyCode: account.currencyCode,
        accountNumber: account.number,
        reason: dto.reason ?? null,
      });
    });
    void this.notifications.dispatch(toNotify);
    return this.detailMine(userId, account.id, orderId);
  }

  /**
   * The customer confirms an order of one of their accounts with their PIN
   * (10b): the PIN first (a wrong one counts toward the sign-in lockout), then
   * the debit, once. `replayed`: this key already confirmed this order.
   */
  async confirmMine(
    user: AuthenticatedUser,
    accountId: string,
    orderId: string,
    pin: string,
    idempotencyKey: string,
  ): Promise<{ order: MyOrderView; replayed: boolean }> {
    const account = await this.prisma.account.findFirst({
      where: { id: accountId, customerId: user.userId },
      select: { id: true, storeId: true },
    });
    if (!account) {
      throw accountNotFound();
    }
    await this.pinCheck.verify(user.userId, pin);
    const { replayed } = await this.confirmation.debit({
      storeId: account.storeId,
      accountId: account.id,
      orderId: orderId.toLowerCase(),
      channel: OrderConfirmationChannel.PIN,
      actorId: user.userId,
      device: user.deviceId,
      idempotencyKey,
    });
    return {
      order: await this.detailMine(user.userId, account.id, orderId),
      replayed,
    };
  }

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

    const { orderId, toNotify } = await this.prisma.$transaction(async (tx) => {
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
        select: { id: true, reference: true },
      });
      // Straight to the customer: tell them it awaits their confirmation.
      const toNotify =
        status === MaterialOrderStatus.AWAITING_CUSTOMER
          ? await this.notifyAwaitingCustomer(tx, order.id)
          : [];
      return { orderId: order.id, toNotify };
    });
    void this.notifications.dispatch(toNotify);
    return this.detail(store.storeId, orderId);
  }

  /** The manager validates a seller's order above the threshold: it goes to the customer. */
  async validate(
    store: CurrentStoreContext,
    actor: AuthenticatedUser,
    orderId: string,
  ): Promise<OrderView> {
    const toNotify = await this.transition(
      store,
      orderId,
      [MaterialOrderStatus.AWAITING_VALIDATION],
      {
        status: MaterialOrderStatus.AWAITING_CUSTOMER,
        validatedById: actor.userId,
        validatedAt: new Date(),
      },
      undefined,
      // Validated: it now awaits the customer, who is told so.
      (tx) => this.notifyAwaitingCustomer(tx, orderId),
    );
    void this.notifications.dispatch(toNotify);
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
    onChanged?: (tx: Tx) => Promise<string[]>,
  ): Promise<string[]> {
    return this.prisma.$transaction(async (tx) => {
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
        // Notification rows of the change, in its transaction (the outbox).
        return onChanged ? onChanged(tx) : [];
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

  /** The rows telling an order's customer that it awaits their confirmation. */
  private async notifyAwaitingCustomer(
    tx: Tx,
    orderId: string,
  ): Promise<string[]> {
    const order = await tx.materialOrder.findUniqueOrThrow({
      where: { id: orderId },
      select: {
        storeId: true,
        reference: true,
        total: true,
        account: { select: { customerId: true, currencyCode: true } },
        store: { select: { name: true } },
      },
    });
    return this.notifications.recordOrderAwaitingCustomer(tx, {
      customerId: order.account.customerId,
      storeId: order.storeId,
      storeName: order.store.name,
      reference: order.reference,
      total: order.total,
      currencyCode: order.account.currencyCode,
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
