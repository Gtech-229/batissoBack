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
import { ActivityAction, type Prisma } from '../generated/prisma/client.js';
import type { AuthenticatedUser } from '../mobile-auth/authenticated-user.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type { CurrentStoreContext } from '../store-access/current-store.js';
import { lockVerifiedStore } from '../store-access/verified-store.js';
import {
  invalidFields,
  PHONE_NOT_OF_COUNTRY,
} from '../stores/stores.errors.js';
import { formatAccountNumber } from './account-number.js';
import {
  accountExists,
  accountNotFound,
  OPENING_REFUSAL,
  ownAccount,
} from './accounts.errors.js';
import {
  ACCOUNT_DETAIL_INCLUDE,
  toAccountDetail,
  type AccountDetail,
} from './dto/account-detail.js';
import {
  toAccountSummary,
  type AccountSummary,
  type ListAccountsQueryDto,
} from './dto/list-accounts.dto.js';
import { toMyAccount, type MyAccount } from './dto/my-account.js';
import type { OpenAccountDto } from './dto/open-account.dto.js';

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
  constructor(private readonly prisma: PrismaService) {}

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

      // nextval is atomic: two openings never get the same value, and it never
      // rolls back (a refused opening leaves a harmless gap).
      const [{ value }] = await tx.$queryRaw<{ value: bigint }[]>`
        SELECT nextval('account_number_seq') AS value
      `;
      const number = formatAccountNumber(value);

      // Same pattern on the (customer, store) unique index: a parallel opening
      // for the same customer waits here for the first one, then inserts
      // nothing and is refused.
      const { count } = await tx.account.createMany({
        data: [
          {
            number,
            customerId: customer.id,
            storeId: store.storeId,
            currencyCode,
            beneficiaryName: dto.beneficiary?.name ?? null,
            beneficiaryPhone,
            termsAcceptedAt: new Date(),
            openedById: actor.userId,
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
          storeId: store.storeId,
          userId: actor.userId,
          action: ActivityAction.ACCOUNT_OPENED,
          newValue: { accountId, number, customerId: customer.id },
          device: actor.deviceId,
        },
      });

      const account = await tx.account.findUniqueOrThrow({
        where: { id: accountId },
        include: ACCOUNT_DETAIL_INCLUDE,
      });
      return toAccountDetail(account);
    });
  }

  /**
   * This store's accounts, newest first. `q` matches the account number, the
   * customer's phone (as typed, or normalized when it is a valid number of the
   * store's country, so "76 44 55 66" finds +22376445566), or a name.
   */
  async list(
    storeId: string,
    query: ListAccountsQueryDto,
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
    return paginated(accounts.map(toAccountSummary), total, query);
  }

  /** One account of this store; another store's account is a 404. */
  async detail(storeId: string, accountId: string): Promise<AccountDetail> {
    const account = await this.prisma.account.findFirst({
      where: { id: accountId, storeId },
      include: ACCOUNT_DETAIL_INCLUDE,
    });
    if (!account) {
      throw accountNotFound();
    }
    return toAccountDetail(account);
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
  async scan(storeId: string, code: string): Promise<AccountDetail> {
    const account = await this.prisma.account.findFirst({
      where: { storeId, customer: { qrCode: code } },
      include: ACCOUNT_DETAIL_INCLUDE,
    });
    if (!account) {
      throw accountNotFound();
    }
    return toAccountDetail(account);
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
