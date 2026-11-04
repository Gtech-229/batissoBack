import { Injectable } from '@nestjs/common';
import { accountNotFound } from '../accounts/accounts.errors.js';
import {
  ONE_SNAPSHOT,
  paginated,
  toSkipTake,
  type Paginated,
} from '../common/pagination.js';
import {
  DisputeAuthor,
  DisputeStatus,
  Prisma,
} from '../generated/prisma/client.js';
import { operationNotFound } from '../ledger/ledger.errors.js';
import type { AuthenticatedUser } from '../mobile-auth/authenticated-user.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type { CurrentStoreContext } from '../store-access/current-store.js';
import {
  disputeAlreadyOpen,
  disputeClosed,
  disputeNotFound,
} from './disputes.errors.js';
import type { DisputeMessageDto } from './dto/dispute-message.dto.js';
import {
  DISPUTE_INCLUDE,
  MY_DISPUTE_INCLUDE,
  toDisputeView,
  toMyDisputeView,
  type DisputeView,
  type MyDisputeView,
} from './dto/dispute-view.js';
import {
  UNRESOLVED_STATUSES,
  type AdminDisputesQueryDto,
  type ListDisputesQueryDto,
  type ListMyDisputesQueryDto,
} from './dto/list-disputes.dto.js';

/** Newest first; the id breaks ties within one millisecond (uuid v7). */
const DISPUTES_ORDER = [
  { createdAt: 'desc' },
  { id: 'desc' },
] satisfies Prisma.DisputeOrderByWithRelationInput[];

/**
 * Disputes (feature 12): a customer contests an operation of their account and
 * talks it through with the store's manager in one thread. A dispute never
 * changes an operation. No store lock: a closed store's customer can still
 * dispute, since its history stays readable and is proof.
 */
@Injectable()
export class DisputesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  /**
   * The customer opens a dispute on an operation of one of their accounts,
   * with a first message: the dispute and its message in one transaction. One
   * dispute per operation at a time: the partial unique index refuses a second
   * one while the first is not CLOSED (409 DISPUTE_ALREADY_OPEN).
   */
  async openMine(
    user: AuthenticatedUser,
    accountId: string,
    operationId: string,
    dto: DisputeMessageDto,
  ): Promise<MyDisputeView> {
    const account = await this.ownAccount(user.userId, accountId);
    const operation = await this.prisma.operation.findFirst({
      where: { id: operationId, accountId: account.id },
      select: { id: true },
    });
    if (!operation) {
      throw operationNotFound();
    }
    try {
      const { disputeId, toNotify } = await this.prisma.$transaction(
        async (tx) => {
          const dispute = await tx.dispute.create({
            data: {
              operationId: operation.id,
              accountId: account.id,
              storeId: account.storeId,
              openedById: user.userId,
              status: DisputeStatus.OPEN,
              messages: {
                create: {
                  author: DisputeAuthor.CUSTOMER,
                  authorId: user.userId,
                  body: dto.message,
                },
              },
            },
            select: { id: true },
          });
          // The managers are told in this transaction (sent after the commit).
          const toNotify = await this.notifications.recordDisputeOpened(tx, {
            ...(await this.notice(tx, dispute.id)),
            message: dto.message,
          });
          return { disputeId: dispute.id, toNotify };
        },
      );
      void this.notifications.dispatch(toNotify);
      return this.detailMine(user, account.id, disputeId);
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw disputeAlreadyOpen();
      }
      throw error;
    }
  }

  /** The disputes of one of the customer's accounts, newest first. */
  async listMine(
    user: AuthenticatedUser,
    accountId: string,
    query: ListMyDisputesQueryDto,
  ): Promise<Paginated<MyDisputeView>> {
    const account = await this.ownAccount(user.userId, accountId);
    const where: Prisma.DisputeWhereInput = {
      accountId: account.id,
      status: query.status,
    };
    // REPEATABLE READ: the page and the total come from the same snapshot.
    const [disputes, total] = await this.prisma.$transaction(
      [
        this.prisma.dispute.findMany({
          where,
          include: MY_DISPUTE_INCLUDE,
          orderBy: DISPUTES_ORDER,
          ...toSkipTake(query),
        }),
        this.prisma.dispute.count({ where }),
      ],
      ONE_SNAPSHOT,
    );
    return paginated(disputes.map(toMyDisputeView), total, query);
  }

  /** One dispute of one of the customer's accounts, with its thread; else 404. */
  async detailMine(
    user: AuthenticatedUser,
    accountId: string,
    disputeId: string,
  ): Promise<MyDisputeView> {
    const account = await this.ownAccount(user.userId, accountId);
    const dispute = await this.prisma.dispute.findFirst({
      where: { id: disputeId, accountId: account.id },
      include: MY_DISPUTE_INCLUDE,
    });
    if (!dispute) {
      throw disputeNotFound();
    }
    return toMyDisputeView(dispute);
  }

  /**
   * The customer writes again in their dispute: a CUSTOMER message, and the
   * dispute awaits the store again (OPEN, a reopening when it was ANSWERED).
   * Under the dispute row lock, as the manager's reply.
   */
  async writeMine(
    user: AuthenticatedUser,
    accountId: string,
    disputeId: string,
    dto: DisputeMessageDto,
  ): Promise<MyDisputeView> {
    const account = await this.ownAccount(user.userId, accountId);
    const toNotify = await this.prisma.$transaction(async (tx) => {
      await this.lockWritable(tx, { id: disputeId, accountId: account.id });
      await this.write(tx, disputeId, {
        author: DisputeAuthor.CUSTOMER,
        authorId: user.userId,
        body: dto.message,
        status: DisputeStatus.OPEN,
      });
      return this.notifications.recordDisputeCustomerMessage(tx, {
        ...(await this.notice(tx, disputeId)),
        message: dto.message,
      });
    });
    void this.notifications.dispatch(toNotify);
    return this.detailMine(user, account.id, disputeId);
  }

  /**
   * The customer closes their dispute: they accept the answer, or withdraw
   * it while it is still OPEN (recorded choice). Final: a later disagreement
   * is a new dispute. One conditional write, so a parallel reply either lands
   * first or finds it CLOSED.
   */
  async closeMine(
    user: AuthenticatedUser,
    accountId: string,
    disputeId: string,
  ): Promise<MyDisputeView> {
    const account = await this.ownAccount(user.userId, accountId);
    const toNotify = await this.prisma.$transaction(async (tx) => {
      const { count } = await tx.dispute.updateMany({
        where: {
          id: disputeId,
          accountId: account.id,
          status: { in: [DisputeStatus.OPEN, DisputeStatus.ANSWERED] },
        },
        data: { status: DisputeStatus.CLOSED, closedAt: new Date() },
      });
      if (count === 0) {
        const exists = await tx.dispute.count({
          where: { id: disputeId, accountId: account.id },
        });
        throw exists > 0 ? disputeClosed() : disputeNotFound();
      }
      return this.notifications.recordDisputeClosed(
        tx,
        await this.notice(tx, disputeId),
      );
    });
    void this.notifications.dispatch(toNotify);
    return this.detailMine(user, account.id, disputeId);
  }

  /** The store's disputes, newest first, filtered by status and account. */
  async list(
    storeId: string,
    query: ListDisputesQueryDto,
  ): Promise<Paginated<DisputeView>> {
    const where: Prisma.DisputeWhereInput = {
      storeId,
      status: query.status,
      accountId: query.accountId,
    };
    const [disputes, total] = await this.prisma.$transaction(
      [
        this.prisma.dispute.findMany({
          where,
          include: DISPUTE_INCLUDE,
          orderBy: DISPUTES_ORDER,
          ...toSkipTake(query),
        }),
        this.prisma.dispute.count({ where }),
      ],
      ONE_SNAPSHOT,
    );
    return paginated(disputes.map(toDisputeView), total, query);
  }

  /**
   * Admins oversee the disputes still waiting for an answer (16c), in every
   * store: OPEN or ANSWERED, never CLOSED. Read-only, the staff view.
   */
  async listUnresolved(
    query: AdminDisputesQueryDto,
  ): Promise<Paginated<DisputeView>> {
    const where: Prisma.DisputeWhereInput = {
      status: query.status ?? { in: [...UNRESOLVED_STATUSES] },
      storeId: query.storeId,
    };
    const [disputes, total] = await this.prisma.$transaction(
      [
        this.prisma.dispute.findMany({
          where,
          include: DISPUTE_INCLUDE,
          orderBy: DISPUTES_ORDER,
          ...toSkipTake(query),
        }),
        this.prisma.dispute.count({ where }),
      ],
      ONE_SNAPSHOT,
    );
    return paginated(disputes.map(toDisputeView), total, query);
  }

  /** One unresolved dispute, any store; a closed one is a 404, like an unknown id. */
  async detailUnresolved(disputeId: string): Promise<DisputeView> {
    const dispute = await this.prisma.dispute.findFirst({
      where: { id: disputeId, status: { in: [...UNRESOLVED_STATUSES] } },
      include: DISPUTE_INCLUDE,
    });
    if (!dispute) {
      throw disputeNotFound();
    }
    return toDisputeView(dispute);
  }

  /** One dispute of this store, with its thread; another store's is a 404. */
  async detail(storeId: string, disputeId: string): Promise<DisputeView> {
    const dispute = await this.prisma.dispute.findFirst({
      where: { id: disputeId, storeId },
      include: DISPUTE_INCLUDE,
    });
    if (!dispute) {
      throw disputeNotFound();
    }
    return toDisputeView(dispute);
  }

  /**
   * The manager replies in a dispute of their store: a STORE message, and
   * the dispute now awaits the customer (ANSWERED). Under the dispute row
   * lock, so a parallel close or message is seen before writing.
   */
  async reply(
    store: CurrentStoreContext,
    actor: AuthenticatedUser,
    disputeId: string,
    dto: DisputeMessageDto,
  ): Promise<DisputeView> {
    const toNotify = await this.prisma.$transaction(async (tx) => {
      await this.lockWritable(tx, { id: disputeId, storeId: store.storeId });
      await this.write(tx, disputeId, {
        author: DisputeAuthor.STORE,
        authorId: actor.userId,
        body: dto.message,
        status: DisputeStatus.ANSWERED,
      });
      return this.notifications.recordDisputeStoreReply(tx, {
        ...(await this.notice(tx, disputeId)),
        message: dto.message,
      });
    });
    void this.notifications.dispatch(toNotify);
    return this.detail(store.storeId, disputeId);
  }

  /**
   * Locks the dispute row FOR UPDATE, found by id and its store or account
   * (404 otherwise), and refuses a CLOSED one (409 DISPUTE_STATUS).
   */
  private async lockWritable(
    tx: Prisma.TransactionClient,
    scope: { id: string; storeId?: string; accountId?: string },
  ): Promise<void> {
    const [row] = await tx.$queryRaw<
      { status: DisputeStatus; storeId: string; accountId: string }[]
    >`SELECT "status", "storeId", "accountId" FROM "disputes"
      WHERE "id" = ${scope.id}::uuid
      FOR UPDATE`;
    // Another store's or another account's dispute answers like a missing one.
    const inScope =
      row !== undefined &&
      (scope.storeId === undefined || row.storeId === scope.storeId) &&
      (scope.accountId === undefined || row.accountId === scope.accountId);
    if (!inScope) {
      throw disputeNotFound();
    }
    if (row.status === DisputeStatus.CLOSED) {
      throw disputeClosed();
    }
  }

  /** What a dispute's notifications name: the operation, the account, the store. */
  private async notice(tx: Prisma.TransactionClient, disputeId: string) {
    const dispute = await tx.dispute.findUniqueOrThrow({
      where: { id: disputeId },
      select: {
        storeId: true,
        operation: { select: { id: true, reference: true } },
        account: { select: { number: true, customerId: true } },
        store: { select: { name: true } },
      },
    });
    return {
      storeId: dispute.storeId,
      storeName: dispute.store.name,
      accountNumber: dispute.account.number,
      customerId: dispute.account.customerId,
      operationId: dispute.operation.id,
      operationReference: dispute.operation.reference,
    };
  }

  /** A message of the thread, and the status it leaves the dispute in. */
  private async write(
    tx: Prisma.TransactionClient,
    disputeId: string,
    message: {
      author: DisputeAuthor;
      authorId: string;
      body: string;
      status: DisputeStatus;
    },
  ): Promise<void> {
    await tx.disputeMessage.create({
      data: {
        disputeId,
        author: message.author,
        authorId: message.authorId,
        body: message.body,
      },
    });
    await tx.dispute.update({
      where: { id: disputeId },
      data: { status: message.status },
    });
  }

  /**
   * The session user's own account, or 404 (never a 403, so account ids
   * cannot be probed).
   */
  private async ownAccount(userId: string, accountId: string) {
    const account = await this.prisma.account.findFirst({
      where: { id: accountId, customerId: userId },
      select: { id: true, storeId: true },
    });
    if (!account) {
      throw accountNotFound();
    }
    return account;
  }
}
