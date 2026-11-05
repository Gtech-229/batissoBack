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
  ActivityAction,
  StoreStatus,
  type Prisma,
} from '../generated/prisma/client.js';
import type { AuthenticatedUser } from '../mobile-auth/authenticated-user.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type { CurrentStoreContext } from '../store-access/current-store.js';
import {
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
  accountExists,
  accountNotFound,
  OPENING_REFUSAL,
  ownAccount,
  phoneNotOfStoreCountry,
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
import type { JoinStoreDto } from './dto/join-store.dto.js';
import type { OpenAccountDto } from './dto/open-account.dto.js';
import { toStorePreview, type StorePreview } from './dto/store-preview.js';

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
   * Writes a new account inside the caller's transaction: the next number, the
   * account (terms accepted now, opened by the actor), its Unassigned goal and
   * the activity log row. Shared by the counter opening and the app join.
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
