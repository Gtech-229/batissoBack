import { Injectable } from '@nestjs/common';
import { escapeLike } from '../common/like.js';
import {
  ONE_SNAPSHOT,
  paginated,
  toSkipTake,
  type Paginated,
} from '../common/pagination.js';
import { AccountStatus, type Prisma } from '../generated/prisma/client.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { lockStoreNotClosed } from '../store-access/verified-store.js';
import {
  accountNotFound,
  invalidAccountTransition,
} from './accounts.errors.js';
import {
  ADMIN_ACCOUNT_INCLUDE,
  toAdminAccountSummary,
  type AdminAccountsQueryDto,
  type AdminAccountSummary,
} from './dto/admin-account.dto.js';

type AccountAction = 'suspend' | 'reactivate';

const TRANSITIONS: Record<
  AccountAction,
  { from: AccountStatus; to: AccountStatus }
> = {
  suspend: { from: AccountStatus.ACTIVE, to: AccountStatus.SUSPENDED },
  reactivate: { from: AccountStatus.SUSPENDED, to: AccountStatus.ACTIVE },
};

/**
 * Admins find customers' accounts across stores and suspend or reactivate one
 * (16b). They never see or change money: no balance, no operation.
 */
@Injectable()
export class AdminAccountsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  /** Newest first; filters combine with AND. */
  async list(
    query: AdminAccountsQueryDto,
  ): Promise<Paginated<AdminAccountSummary>> {
    const where: Prisma.AccountWhereInput = {
      storeId: query.storeId,
      status: query.status,
      ...(query.q && { OR: searchConditions(query.q) }),
    };
    // REPEATABLE READ: the page and the total come from the same snapshot.
    const [accounts, total] = await this.prisma.$transaction(
      [
        this.prisma.account.findMany({
          where,
          include: ADMIN_ACCOUNT_INCLUDE,
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          ...toSkipTake(query),
        }),
        this.prisma.account.count({ where }),
      ],
      ONE_SNAPSHOT,
    );
    return paginated(accounts.map(toAdminAccountSummary), total, query);
  }

  suspend(
    id: string,
    reason: string,
    adminId: string,
  ): Promise<AdminAccountSummary> {
    return this.change(id, 'suspend', reason, adminId);
  }

  reactivate(id: string, adminId: string): Promise<AdminAccountSummary> {
    return this.change(id, 'reactivate', null, adminId);
  }

  /**
   * Locks the store `FOR SHARE` then the account `FOR UPDATE`, the order
   * deposits use: a deposit in progress lands before the change, or is
   * refused after it. The customer's notice is written in the same
   * transaction and sent after the commit.
   */
  private async change(
    id: string,
    action: AccountAction,
    reason: string | null,
    adminId: string,
  ): Promise<AdminAccountSummary> {
    const found = await this.prisma.account.findUnique({
      where: { id },
      select: { storeId: true },
    });
    if (!found) {
      throw accountNotFound();
    }
    const transition = TRANSITIONS[action];
    const { account, notificationIds } = await this.prisma.$transaction(
      async (tx) => {
        await lockStoreNotClosed(tx, found.storeId);
        const [current] = await tx.$queryRaw<{ status: AccountStatus }[]>`
        SELECT "status" FROM "accounts" WHERE "id" = ${id}::uuid FOR UPDATE`;
        if (current?.status !== transition.from) {
          throw invalidAccountTransition(action);
        }
        const updated = await tx.account.update({
          where: { id },
          data: {
            status: transition.to,
            statusReason: reason,
            statusChangedAt: new Date(),
            statusChangedById: adminId,
          },
          include: ADMIN_ACCOUNT_INCLUDE,
        });
        const ids = await this.notifications.recordAccountStatusChanged(tx, {
          customerId: updated.customer.id,
          storeId: updated.store.id,
          storeName: updated.store.name,
          accountNumber: updated.number,
          suspended: transition.to === AccountStatus.SUSPENDED,
        });
        return { account: updated, notificationIds: ids };
      },
    );
    void this.notifications.dispatch(notificationIds);
    return toAdminAccountSummary(account);
  }
}

/** The number, the names, or the digits of the phone. */
function searchConditions(q: string): Prisma.AccountWhereInput[] {
  const text = { contains: escapeLike(q), mode: 'insensitive' } as const;
  const conditions: Prisma.AccountWhereInput[] = [
    { number: text },
    { customer: { firstName: text } },
    { customer: { lastName: text } },
  ];
  // "76 00 00 00" and "+223 76..." find "+22376000000": its digits.
  const digits = q.replace(/\D/g, '');
  if (digits.length >= 2) {
    conditions.push({ customer: { phone: { contains: digits } } });
  }
  return conditions;
}
