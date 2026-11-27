import { Injectable } from '@nestjs/common';
import type { ValidationErrorDetail } from '../common/errors/error-response.js';
import { escapeLike } from '../common/like.js';
import {
  paginated,
  toSkipTake,
  type Paginated,
  ONE_SNAPSHOT,
} from '../common/pagination.js';
import { isPhoneCountry, normalizePhone } from '../common/phone.js';
import {
  AccountStatus,
  ActivityAction,
  DisputeStatus,
  MaterialOrderStatus,
  StoreStatus,
  type Prisma,
} from '../generated/prisma/client.js';
import type { AuthenticatedUser } from '../mobile-auth/authenticated-user.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type { CurrentStoreContext } from '../store-access/current-store.js';
import {
  lockStoreNotClosed,
  lockVerifiedStore,
  storeNotVerified,
} from '../store-access/verified-store.js';
import {
  invalidFields,
  PHONE_NOT_OF_COUNTRY,
  storeNotFound,
} from '../stores/stores.errors.js';
import { formatAccountNumber } from './account-number.js';
import {
  accountClosed,
  accountExists,
  accountNotEmpty,
  accountNotFound,
  disputeInProgress,
  OPENING_REFUSAL,
  orderInProgress,
  ownAccount,
  phoneNotOfStoreCountry,
  suspendedAccountNotClosable,
} from './accounts.errors.js';
import {
  ACCOUNT_DETAIL_INCLUDE,
  closedByOf,
  toAccountDetail,
  type AccountDetail,
} from './dto/account-detail.js';
import {
  toAccountSummary,
  type AccountSummary,
  type ListAccountsQueryDto,
} from './dto/list-accounts.dto.js';
import { toMyAccount, type MyAccount } from './dto/my-account.js';
import type { JoinStoreDto } from './dto/join-store.dto.js';
import type { OpenAccountDto } from './dto/open-account.dto.js';
import { toStorePreview, type StorePreview } from './dto/store-preview.js';

/** Orders that are not final yet: an account with one cannot close (28). */
const ORDERS_IN_PROGRESS = [
  MaterialOrderStatus.AWAITING_VALIDATION,
  MaterialOrderStatus.AWAITING_CUSTOMER,
  MaterialOrderStatus.CONFIRMED,
];

/** Disputes not closed yet: an account with one cannot close (28). */
const DISPUTES_IN_PROGRESS = [DisputeStatus.OPEN, DisputeStatus.ANSWERED];

/** The label of every account's system goal (Unassigned). */
export const UNASSIGNED_GOAL_LABEL = 'Non affecté';

/** What `toMyAccount` needs: the customer's own view of an account. */
const MY_ACCOUNT_INCLUDE = {
  customer: true,
  store: { select: { id: true, name: true } },
  goals: ACCOUNT_DETAIL_INCLUDE.goals,
  projects: ACCOUNT_DETAIL_INCLUDE.projects,
} satisfies Prisma.AccountInclude;

/**
 * Customers' savings accounts. The store always comes from the guard's context
 * (the URL's store, checked against the caller's membership), never from a
 * body; every store-scoped query filters by it.
 */
@Injectable()
export class AccountsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  /**
   * Opens an account at the counter, in one transaction: the customer found by
   * phone or created (names from the staff member, no PIN), the account with
   * the next number, its Unassigned goal, and the activity log row.
   */
  async open(
    store: CurrentStoreContext,
    actor: AuthenticatedUser,
    dto: OpenAccountDto,
  ): Promise<AccountDetail> {
    return this.prisma.$transaction(async (tx) => {
      const { countryCode, currencyCode } = await lockVerifiedStore(
        tx,
        store.storeId,
        OPENING_REFUSAL,
      );

      // Both numbers are checked at once, so one answer lists every mistake.
      const errors: ValidationErrorDetail[] = [];
      const phoneOf = (field: string, value: string): string | null => {
        const phone = isPhoneCountry(countryCode)
          ? normalizePhone(value, countryCode)
          : null;
        if (!phone) {
          errors.push({ field, errors: [PHONE_NOT_OF_COUNTRY(countryCode)] });
        }
        return phone;
      };
      const phone = phoneOf('customer.phone', dto.customer.phone);
      // `== null`: a client may send `phone: null` for "no phone", and
      // @IsOptional lets null through the DTO (F-21).
      const beneficiaryPhone =
        dto.beneficiary?.phone == null
          ? null
          : phoneOf('beneficiary.phone', dto.beneficiary.phone);
      if (!phone || errors.length > 0) {
        throw invalidFields(errors);
      }

      // ON CONFLICT DO NOTHING, then read: race-safe, unlike an upsert (F-07).
      // An existing user keeps their names.
      await tx.user.createMany({
        data: [
          {
            phone,
            firstName: dto.customer.firstName,
            lastName: dto.customer.lastName,
          },
        ],
        skipDuplicates: true,
      });
      const customer = await tx.user.findUniqueOrThrow({ where: { phone } });
      if (customer.id === actor.userId) {
        throw ownAccount();
      }

      const accountId = await this.createAccount(tx, {
        storeId: store.storeId,
        customerId: customer.id,
        currencyCode,
        beneficiaryName: dto.beneficiary?.name ?? null,
        beneficiaryPhone,
        actor,
      });

      const account = await tx.account.findUniqueOrThrow({
        where: { id: accountId },
        include: ACCOUNT_DETAIL_INCLUDE,
      });
      return toAccountDetail(account, actor.userId);
    });
  }

  /**
   * The signed-in user joins the store whose QR code they scanned (21c): the
   * account opens at once, they accepted the store's terms in the app, and the
   * identity photo comes later at the counter. They are both the customer and
   * the opener. Same transaction and rules as a counter opening.
   */
  async join(actor: AuthenticatedUser, dto: JoinStoreDto): Promise<MyAccount> {
    return this.prisma.$transaction(async (tx) => {
      const found = await tx.hardwareStore.findUnique({
        where: { qrCode: dto.code },
        select: { id: true },
      });
      if (!found) {
        throw storeNotFound();
      }
      const { countryCode, currencyCode } = await lockVerifiedStore(
        tx,
        found.id,
        OPENING_REFUSAL,
      );

      const user = await tx.user.findUniqueOrThrow({
        where: { id: actor.userId },
        select: { phone: true },
      });
      const phoneOk =
        isPhoneCountry(countryCode) &&
        normalizePhone(user.phone, countryCode) === user.phone;
      if (!phoneOk) {
        throw phoneNotOfStoreCountry();
      }
      let beneficiaryPhone: string | null = null;
      // `== null`: as at the counter, `phone: null` means "no phone" (F-21).
      if (dto.beneficiary?.phone != null) {
        beneficiaryPhone = isPhoneCountry(countryCode)
          ? normalizePhone(dto.beneficiary.phone, countryCode)
          : null;
        if (!beneficiaryPhone) {
          throw invalidFields([
            {
              field: 'beneficiary.phone',
              errors: [PHONE_NOT_OF_COUNTRY(countryCode)],
            },
          ]);
        }
      }

      const accountId = await this.createAccount(tx, {
        storeId: found.id,
        customerId: actor.userId,
        currencyCode,
        beneficiaryName: dto.beneficiary?.name ?? null,
        beneficiaryPhone,
        actor,
      });
      return toMyAccount(
        await tx.account.findUniqueOrThrow({
          where: { id: accountId },
          include: MY_ACCOUNT_INCLUDE,
        }),
      );
    });
  }

  /**
   * The signed-in customer leaves the store of one of their accounts (28).
   * Another user's account answers 404.
   */
  async leave(actor: AuthenticatedUser, accountId: string): Promise<MyAccount> {
    const found = await this.prisma.account.findFirst({
      where: { id: accountId, customerId: actor.userId },
      select: { storeId: true },
    });
    if (!found) {
      throw accountNotFound();
    }
    return this.prisma.$transaction(async (tx) => {
      await this.closeAccount(tx, {
        storeId: found.storeId,
        accountId,
        actor,
        reason: null,
      });
      return toMyAccount(
        await tx.account.findUniqueOrThrow({
          where: { id: accountId },
          include: MY_ACCOUNT_INCLUDE,
        }),
      );
    });
  }

  /**
   * The store's manager closes a customer's account, with a reason (28). The
   * customer's notice is written in the transaction and sent after the commit.
   */
  async close(
    store: CurrentStoreContext,
    actor: AuthenticatedUser,
    accountId: string,
    reason: string,
  ): Promise<AccountDetail> {
    const { detail, toNotify } = await this.prisma.$transaction(async (tx) => {
      await this.closeAccount(tx, {
        storeId: store.storeId,
        accountId,
        actor,
        reason,
      });
      const account = await tx.account.findUniqueOrThrow({
        where: { id: accountId },
        include: { ...ACCOUNT_DETAIL_INCLUDE, store: true },
      });
      const ids = await this.notifications.recordAccountClosedByStore(tx, {
        customerId: account.customerId,
        storeId: account.storeId,
        storeName: account.store.name,
        accountNumber: account.number,
      });
      return {
        detail: toAccountDetail(account, actor.userId),
        toNotify: ids,
      };
    });
    void this.notifications.dispatch(toNotify);
    return detail;
  }

  /**
   * Closes an account of the store inside the caller's transaction (28). Locks
   * the store `FOR SHARE` (not closed), then the account `FOR UPDATE`, the
   * order deposits use: a deposit in progress lands first, and the zero
   * balance is read after it. Orders and disputes are counted under the
   * account lock, which their creation also takes.
   */
  private async closeAccount(
    tx: Prisma.TransactionClient,
    data: {
      storeId: string;
      accountId: string;
      actor: AuthenticatedUser;
      reason: string | null;
    },
  ): Promise<void> {
    await lockStoreNotClosed(tx, data.storeId);
    const [account] = await tx.$queryRaw<
      {
        customerId: string;
        number: string;
        balance: bigint;
        status: AccountStatus;
      }[]
    >`SELECT "customerId", "number", "balance", "status" FROM "accounts"
      WHERE "id" = ${data.accountId}::uuid AND "storeId" = ${data.storeId}::uuid
      FOR UPDATE`;
    if (!account) {
      throw accountNotFound();
    }
    if (account.status === AccountStatus.CLOSED) {
      throw accountClosed();
    }
    if (account.status === AccountStatus.SUSPENDED) {
      throw suspendedAccountNotClosable();
    }
    if (account.balance !== 0n) {
      throw accountNotEmpty();
    }
    const orders = await tx.materialOrder.count({
      where: { accountId: data.accountId, status: { in: ORDERS_IN_PROGRESS } },
    });
    if (orders > 0) {
      throw orderInProgress();
    }
    const disputes = await tx.dispute.count({
      where: {
        accountId: data.accountId,
        status: { in: DISPUTES_IN_PROGRESS },
      },
    });
    if (disputes > 0) {
      throw disputeInProgress();
    }

    await tx.account.update({
      where: { id: data.accountId },
      data: {
        status: AccountStatus.CLOSED,
        closedAt: new Date(),
        closedById: data.actor.userId,
        closedReason: data.reason,
      },
    });
    await tx.activityLog.create({
      data: {
        storeId: data.storeId,
        userId: data.actor.userId,
        action: ActivityAction.ACCOUNT_CLOSED,
        newValue: {
          accountId: data.accountId,
          number: account.number,
          closedBy: closedByOf({
            customerId: account.customerId,
            closedById: data.actor.userId,
          }),
        },
        device: data.actor.deviceId,
      },
    });
  }

  /**
   * Writes a new account inside the caller's transaction: the next number, the
   * account (terms accepted now, opened by the actor), its Unassigned goal and
   * the activity log row. Shared by the counter opening and the app join.
   * A CLOSED account of this customer in this store reopens instead (28).
   */
  private async createAccount(
    tx: Prisma.TransactionClient,
    data: {
      storeId: string;
      customerId: string;
      currencyCode: string;
      beneficiaryName: string | null;
      beneficiaryPhone: string | null;
      actor: AuthenticatedUser;
    },
  ): Promise<string> {
    const reopened = await this.reopenIfClosed(tx, data);
    if (reopened) {
      return reopened;
    }

    // nextval is atomic: two openings never get the same value, and it never
    // rolls back (a refused opening leaves a harmless gap).
    const [{ value }] = await tx.$queryRaw<{ value: bigint }[]>`
      SELECT nextval('account_number_seq') AS value
    `;
    const number = formatAccountNumber(value);

    // ON CONFLICT DO NOTHING on the (customer, store) unique index: a parallel
    // opening for the same customer waits here for the first one, then
    // inserts nothing and is refused.
    const { count } = await tx.account.createMany({
      data: [
        {
          number,
          customerId: data.customerId,
          storeId: data.storeId,
          currencyCode: data.currencyCode,
          beneficiaryName: data.beneficiaryName,
          beneficiaryPhone: data.beneficiaryPhone,
          termsAcceptedAt: new Date(),
          openedById: data.actor.userId,
        },
      ],
      skipDuplicates: true,
    });
    if (count === 0) {
      throw accountExists();
    }
    const { id: accountId } = await tx.account.findUniqueOrThrow({
      where: { number },
      select: { id: true },
    });

    await tx.goal.create({
      data: { accountId, label: UNASSIGNED_GOAL_LABEL, isSystem: true },
    });

    await tx.activityLog.create({
      data: {
        storeId: data.storeId,
        userId: data.actor.userId,
        action: ActivityAction.ACCOUNT_OPENED,
        newValue: { accountId, number, customerId: data.customerId },
        device: data.actor.deviceId,
      },
    });
    return accountId;
  }

  /**
   * The customer's existing account in this store, locked `FOR UPDATE` (after
   * the store lock, the usual order): null when there is none; ACCOUNT_EXISTS
   * when it is active or suspended; reopened when it is CLOSED (28): ACTIVE
   * again, terms accepted now, the request's beneficiary, the closed fields
   * cleared; its number, history, goals and photo stay. A parallel reopening
   * waits here, then finds it active.
   */
  private async reopenIfClosed(
    tx: Prisma.TransactionClient,
    data: {
      storeId: string;
      customerId: string;
      beneficiaryName: string | null;
      beneficiaryPhone: string | null;
      actor: AuthenticatedUser;
    },
  ): Promise<string | null> {
    const [existing] = await tx.$queryRaw<
      { id: string; number: string; status: AccountStatus }[]
    >`SELECT "id", "number", "status" FROM "accounts"
      WHERE "customerId" = ${data.customerId}::uuid
        AND "storeId" = ${data.storeId}::uuid
      FOR UPDATE`;
    if (!existing) {
      return null;
    }
    if (existing.status !== AccountStatus.CLOSED) {
      throw accountExists();
    }
    await tx.account.update({
      where: { id: existing.id },
      data: {
        status: AccountStatus.ACTIVE,
        termsAcceptedAt: new Date(),
        beneficiaryName: data.beneficiaryName,
        beneficiaryPhone: data.beneficiaryPhone,
        closedAt: null,
        closedById: null,
        closedReason: null,
      },
    });
    await tx.activityLog.create({
      data: {
        storeId: data.storeId,
        userId: data.actor.userId,
        action: ActivityAction.ACCOUNT_REOPENED,
        newValue: { accountId: existing.id, number: existing.number },
        device: data.actor.deviceId,
      },
    });
    return existing.id;
  }

  /**
   * This store's accounts, newest first. `q` matches the account number, the
   * customer's phone (as typed, or normalized when it is a valid number of the
   * store's country, so "76 44 55 66" finds +22376445566), or a name.
   */
  async list(
    storeId: string,
    query: ListAccountsQueryDto,
    viewerId: string,
  ): Promise<Paginated<AccountSummary>> {
    const where: Prisma.AccountWhereInput = {
      storeId,
      ...(query.q && { OR: await this.searchConditions(storeId, query.q) }),
    };
    // REPEATABLE READ: the page and the total come from the same snapshot.
    const [accounts, total] = await this.prisma.$transaction(
      [
        this.prisma.account.findMany({
          where,
          include: { customer: true },
          // id breaks ties within one millisecond (uuid v7 is time-ordered).
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          ...toSkipTake(query),
        }),
        this.prisma.account.count({ where }),
      ],
      ONE_SNAPSHOT,
    );
    return paginated(
      accounts.map((account) => toAccountSummary(account, viewerId)),
      total,
      query,
    );
  }

  /** One account of this store; another store's account is a 404. */
  async detail(
    storeId: string,
    accountId: string,
    viewerId: string,
  ): Promise<AccountDetail> {
    const account = await this.prisma.account.findFirst({
      where: { id: accountId, storeId },
      include: ACCOUNT_DETAIL_INCLUDE,
    });
    if (!account) {
      throw accountNotFound();
    }
    return toAccountDetail(account, viewerId);
  }

  /**
   * The signed-in user's own accounts, in every store, newest first. The user
   * comes from the session, never from the request; a user with no account
   * (staff only, for example) gets an empty list.
   */
  async mine(userId: string): Promise<MyAccount[]> {
    const accounts = await this.prisma.account.findMany({
      where: { customerId: userId },
      include: MY_ACCOUNT_INCLUDE,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });
    return accounts.map(toMyAccount);
  }

  /**
   * Staff scanned a customer's QR code (feature 23): that customer's account
   * in this store. One query on the code and the guard's store, so an unknown
   * or replaced code and a person with no account here give the same 404: a
   * store learns nothing about people who are not its customers.
   */
  async scan(
    storeId: string,
    code: string,
    viewerId: string,
  ): Promise<AccountDetail> {
    const account = await this.prisma.account.findFirst({
      where: { storeId, customer: { qrCode: code } },
      include: ACCOUNT_DETAIL_INCLUDE,
    });
    if (!account) {
      throw accountNotFound();
    }
    return toAccountDetail(account, viewerId);
  }

  /**
   * A customer scanned a store's QR code: their own account there, or the
   * same 404 whatever the reason (joining a store is feature 21).
   */
  async scanMine(userId: string, code: string): Promise<MyAccount> {
    const account = await this.prisma.account.findFirst({
      where: { customerId: userId, store: { qrCode: code } },
      include: MY_ACCOUNT_INCLUDE,
    });
    if (!account) {
      throw accountNotFound();
    }
    return toMyAccount(account);
  }

  /**
   * The store behind a scanned code, before the user joins it (21c): its rules
   * and terms. Read-only. Only a VERIFIED store can be joined, so another
   * status answers the counter opening's 409.
   */
  async previewStore(code: string): Promise<StorePreview> {
    const store = await this.prisma.hardwareStore.findUnique({
      where: { qrCode: code },
      include: { country: true, settings: true },
    });
    if (!store) {
      // Unknown and regenerated codes look the same.
      throw storeNotFound();
    }
    if (store.status !== StoreStatus.VERIFIED) {
      throw storeNotVerified(store.status, OPENING_REFUSAL);
    }
    return toStorePreview(store);
  }

  private async searchConditions(
    storeId: string,
    q: string,
  ): Promise<Prisma.AccountWhereInput[]> {
    const text = { contains: escapeLike(q), mode: 'insensitive' } as const;
    const conditions: Prisma.AccountWhereInput[] = [
      { number: text },
      { customer: { phone: text } },
      { customer: { firstName: text } },
      { customer: { lastName: text } },
    ];
    const { countryCode } = await this.prisma.hardwareStore.findUniqueOrThrow({
      where: { id: storeId },
      select: { countryCode: true },
    });
    const phone = isPhoneCountry(countryCode)
      ? normalizePhone(q, countryCode)
      : null;
    if (phone) {
      conditions.push({ customer: { phone } });
    }
    return conditions;
  }
}
