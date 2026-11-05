import { Injectable } from '@nestjs/common';
import { definedOnly } from '../common/defined-only.js';
import type { ValidationErrorDetail } from '../common/errors/error-response.js';
import { parseAmount } from '../common/money.js';
import {
  paginated,
  toSkipTake,
  type Paginated,
  ONE_SNAPSHOT,
} from '../common/pagination.js';
import { DEFAULT_ARTICLE_CATEGORIES } from '../catalogue/default-categories.js';
import { escapeLike } from '../common/like.js';
import { isPhoneCountry, normalizePhone } from '../common/phone.js';
import { countryNotFound } from '../countries/countries.errors.js';
import {
  Prisma,
  StoreMemberRole,
  StoreStatus,
  type SubscriptionPlan,
} from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { subscriptionStateWhere } from '../subscriptions/store-subscription.js';
import {
  STORE_DETAIL_INCLUDE,
  toStoreDetail,
  type StoreDetail,
} from './dto/store-detail.js';
import {
  toStoreSummary,
  type ListStoresQueryDto,
  type StoreSummary,
} from './dto/list-stores.dto.js';
import type { RegisterStoreDto } from './dto/register-store.dto.js';
import type { RegisterOwnStoreDto } from './dto/register-own-store.dto.js';
import {
  REGISTERED_STORE_INCLUDE,
  toRegisteredStore,
  type RegisteredStore,
} from './dto/registered-store.js';
import { toStoreDocuments } from './dto/store-documents.js';
import {
  STORE_ACTION_LABELS,
  STORE_STATUS_LABELS,
  STORE_TRANSITIONS,
  type StoreAction,
} from './store-lifecycle.js';
import type {
  UpdateStoreDto,
  UpdateStoreSettingsDto,
} from './dto/update-store.dto.js';
import {
  countryInactive,
  invalidFields,
  MIN_DEPOSIT_ABOVE_MAX_BALANCE,
  PHONE_NOT_OF_COUNTRY,
  invalidStatusTransition,
  noActiveCountry,
  storeAlreadyRegistered,
  storeClosed,
  storeDocumentsMissing,
  storeNotFound,
} from './stores.errors.js';

/** Stores a verification may apply to: admin-registered, or with both documents. */
const VERIFIABLE: Prisma.HardwareStoreWhereInput[] = [
  { registeredById: null },
  { managerIdPhotoPath: { not: null }, tradeRegisterPhotoPath: { not: null } },
];

/** A store's money settings, parsed. */
interface StoreAmounts {
  maxBalance: bigint;
  validationThreshold: bigint;
  minDeposit: bigint;
}

@Injectable()
export class StoresService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Registers a store as PENDING, with its settings, its first manager, and the
   * default article categories, in one transaction: either all exist
   * afterwards, or none does.
   */
  async register(dto: RegisterStoreDto, adminId: string): Promise<StoreDetail> {
    return this.prisma.$transaction(async (tx) => {
      // FOR SHARE: a concurrent deactivation (which locks FOR UPDATE) waits for
      // this registration, so a store never lands in a just-deactivated country.
      const [country] = await tx.$queryRaw<{ active: boolean }[]>`
        SELECT "active" FROM "countries" WHERE "code" = ${dto.countryCode} FOR SHARE`;
      if (!country) {
        throw countryNotFound();
      }
      if (!country.active) {
        throw countryInactive(dto.countryCode);
      }

      const { storePhone, amounts, managerPhone } = this.checkRegistration(
        dto.countryCode,
        dto,
        dto.manager.phone,
      );

      // An existing person (same phone) becomes the manager; their names are
      // kept, since they may already be known elsewhere. createMany with
      // skipDuplicates is one INSERT ... ON CONFLICT DO NOTHING: when a
      // concurrent registration is inserting the same phone, this waits for it
      // and skips instead of failing (an upsert would collide on the unique
      // phone and abort the transaction).
      await tx.user.createMany({
        data: [
          {
            phone: managerPhone!,
            firstName: dto.manager.firstName,
            lastName: dto.manager.lastName,
          },
        ],
        skipDuplicates: true,
      });
      const manager = await tx.user.findUniqueOrThrow({
        where: { phone: managerPhone! },
      });

      const id = await this.createStore(tx, dto, {
        countryCode: dto.countryCode,
        phone: storePhone,
        amounts,
        managerId: manager.id,
        createdById: adminId,
      });
      return toStoreDetail(
        await tx.hardwareStore.findUniqueOrThrow({
          where: { id },
          include: STORE_DETAIL_INCLUDE,
        }),
      );
    });
  }

  /**
   * A signed-in user registers their own store (21b): PENDING, in the active
   * country, the registrant its manager, with the plan they ask for. One store
   * per user, ever: the unique registeredById refuses a second one, even when
   * two registrations run at the same time.
   */
  async registerOwn(
    dto: RegisterOwnStoreDto,
    userId: string,
  ): Promise<RegisteredStore> {
    try {
      return await this.prisma.$transaction(async (tx) => {
        // FOR SHARE, as for an admin registration: a concurrent deactivation
        // waits for this one. One active country in V1.
        const [country] = await tx.$queryRaw<{ code: string }[]>`
          SELECT "code" FROM "countries" WHERE "active"
          ORDER BY "code" LIMIT 1 FOR SHARE`;
        if (!country) {
          throw noActiveCountry();
        }
        const existing = await tx.hardwareStore.findUnique({
          where: { registeredById: userId },
          select: { id: true },
        });
        if (existing) {
          throw storeAlreadyRegistered();
        }
        const { storePhone, amounts } = this.checkRegistration(
          country.code,
          dto,
        );

        const id = await this.createStore(tx, dto, {
          countryCode: country.code,
          phone: storePhone,
          amounts,
          managerId: userId,
          registeredById: userId,
          requestedPlan: dto.requestedPlan,
        });
        return toRegisteredStore(
          await tx.hardwareStore.findUniqueOrThrow({
            where: { id },
            include: REGISTERED_STORE_INCLUDE,
          }),
        );
      });
    } catch (error) {
      // P2002: the only unique value a new store can repeat is registeredById
      // (a parallel registration by the same user committed first).
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw storeAlreadyRegistered();
      }
      throw error;
    }
  }

  /**
   * Writes a PENDING store with its settings, its first manager and the
   * default article categories, inside the caller's transaction: either all
   * exist afterwards, or none does. Admin registrations set createdById;
   * self-registrations set registeredById and requestedPlan.
   */
  private async createStore(
    tx: Prisma.TransactionClient,
    fields: Pick<
      RegisterStoreDto,
      'name' | 'address' | 'city' | 'tradeRegister' | 'settings'
    >,
    store: {
      countryCode: string;
      phone: string;
      amounts: StoreAmounts;
      managerId: string;
      createdById?: string;
      registeredById?: string;
      requestedPlan?: SubscriptionPlan;
    },
  ): Promise<string> {
    const created = await tx.hardwareStore.create({
      data: {
        countryCode: store.countryCode,
        name: fields.name,
        address: fields.address,
        city: fields.city,
        phone: store.phone,
        tradeRegister: fields.tradeRegister,
        status: StoreStatus.PENDING,
        createdById: store.createdById,
        registeredById: store.registeredById,
        requestedPlan: store.requestedPlan,
        settings: {
          create: {
            ...store.amounts,
            terms: fields.settings.terms,
            deliveryDelayDays: fields.settings.deliveryDelayDays,
            // The admin who set them; null when the registrant did.
            updatedById: store.createdById,
          },
        },
        members: {
          create: { userId: store.managerId, role: StoreMemberRole.MANAGER },
        },
        categories: {
          createMany: {
            data: DEFAULT_ARTICLE_CATEGORIES.map((name) => ({ name })),
          },
        },
      },
      select: { id: true },
    });
    return created.id;
  }

  /** Newest first; filters combine with AND. */
  async list(query: ListStoresQueryDto): Promise<Paginated<StoreSummary>> {
    const search = query.q && escapeLike(query.q);
    const where: Prisma.HardwareStoreWhereInput = {
      status: query.status,
      countryCode: query.countryCode,
      ...(query.subscriptionState &&
        subscriptionStateWhere(query.subscriptionState)),
      ...(search && {
        OR: [
          { name: { contains: search, mode: 'insensitive' } },
          { city: { contains: search, mode: 'insensitive' } },
        ],
      }),
    };
    // REPEATABLE READ: the page and the total come from the same snapshot.
    const [stores, total] = await this.prisma.$transaction(
      [
        this.prisma.hardwareStore.findMany({
          where,
          // id breaks ties between stores created in the same millisecond, so
          // pages never repeat or skip a store.
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          include: { subscriptions: true },
          ...toSkipTake(query),
        }),
        this.prisma.hardwareStore.count({ where }),
      ],
      ONE_SNAPSHOT,
    );
    return paginated(stores.map(toStoreSummary), total, query);
  }

  /** Corrects store information; the phone is re-validated for its country. */
  async update(id: string, dto: UpdateStoreDto): Promise<StoreDetail> {
    const changes = definedOnly(dto);

    return this.prisma.$transaction(async (tx) => {
      const store = await this.lockOpenStore(tx, id);

      if (changes.phone !== undefined) {
        const code = store.countryCode;
        const phone = isPhoneCountry(code)
          ? normalizePhone(changes.phone, code)
          : null;
        if (!phone) {
          throw invalidFields([
            { field: 'phone', errors: [PHONE_NOT_OF_COUNTRY(code)] },
          ]);
        }
        changes.phone = phone;
      }

      const updated = await tx.hardwareStore.update({
        where: { id },
        data: changes,
        include: STORE_DETAIL_INCLUDE,
      });
      return toStoreDetail(updated);
    });
  }

  /**
   * Partial settings update. The minimum deposit rule is checked on the values
   * the store will have afterwards (new ones merged with the current ones).
   */
  async updateSettings(
    id: string,
    dto: UpdateStoreSettingsDto,
    adminId: string,
  ): Promise<StoreDetail> {
    const changes = definedOnly(dto);

    return this.prisma.$transaction(async (tx) => {
      await this.lockOpenStore(tx, id);
      const current = await tx.storeSettings.findUniqueOrThrow({
        where: { storeId: id },
      });

      const amounts = {
        maxBalance:
          changes.maxBalance !== undefined
            ? parseAmount(changes.maxBalance)
            : undefined,
        validationThreshold:
          changes.validationThreshold !== undefined
            ? parseAmount(changes.validationThreshold)
            : undefined,
        minDeposit:
          changes.minDeposit !== undefined
            ? parseAmount(changes.minDeposit)
            : undefined,
      };
      const maxBalance = amounts.maxBalance ?? current.maxBalance;
      const minDeposit = amounts.minDeposit ?? current.minDeposit;
      if (minDeposit > maxBalance) {
        // Point at the field the admin sent; minDeposit when both were sent.
        const field =
          amounts.minDeposit !== undefined ? 'minDeposit' : 'maxBalance';
        throw invalidFields([
          { field, errors: [MIN_DEPOSIT_ABOVE_MAX_BALANCE] },
        ]);
      }

      await tx.storeSettings.update({
        where: { storeId: id },
        data: {
          ...definedOnly(amounts),
          ...(changes.terms !== undefined && { terms: changes.terms }),
          deliveryDelayDays: changes.deliveryDelayDays,
          updatedById: adminId,
        },
      });
      const updated = await tx.hardwareStore.findUniqueOrThrow({
        where: { id },
        include: STORE_DETAIL_INCLUDE,
      });
      return toStoreDetail(updated);
    });
  }

  /**
   * Applies one lifecycle action. The update only matches a row whose status
   * is one the action allows, so two concurrent changes cannot both succeed:
   * the second finds the status already changed and gets a 409.
   */
  async changeStatus(
    id: string,
    action: StoreAction,
    adminId: string,
    reason?: string,
  ): Promise<StoreDetail> {
    const transition = STORE_TRANSITIONS[action];
    const now = new Date();

    const { count } = await this.prisma.hardwareStore.updateMany({
      where: {
        id,
        status: { in: [...transition.from] },
        // A self-registered store is verified with both documents only. In the
        // same UPDATE, so an upload (which locks the row) cannot interleave.
        ...(action === 'verify' && { OR: [...VERIFIABLE] }),
      },
      data: {
        status: transition.to,
        statusChangedAt: now,
        statusChangedById: adminId,
        // Verify and reactivate clear the previous suspension reason.
        statusReason: transition.needsReason ? reason : null,
        ...(action === 'verify' && { verifiedAt: now }),
      },
    });

    if (count === 0) {
      const current = await this.prisma.hardwareStore.findUnique({
        where: { id },
        select: {
          status: true,
          registeredById: true,
          managerIdPhotoPath: true,
          tradeRegisterPhotoPath: true,
        },
      });
      if (!current) {
        throw storeNotFound();
      }
      if (
        action === 'verify' &&
        transition.from.includes(current.status) &&
        current.registeredById !== null
      ) {
        throw storeDocumentsMissing(toStoreDocuments(current));
      }
      throw invalidStatusTransition(
        STORE_ACTION_LABELS[action],
        STORE_STATUS_LABELS[current.status],
      );
    }
    return this.findOne(id);
  }

  /**
   * Locks the store row for the rest of the transaction, so a concurrent
   * status change (close) cannot interleave with an update. Closed stores are
   * final and refused.
   */
  private async lockOpenStore(
    tx: Prisma.TransactionClient,
    id: string,
  ): Promise<{ status: StoreStatus; countryCode: string }> {
    const [store] = await tx.$queryRaw<
      { status: StoreStatus; countryCode: string }[]
    >`SELECT "status", "countryCode" FROM "hardware_stores" WHERE "id" = ${id}::uuid FOR UPDATE`;
    if (!store) {
      throw storeNotFound();
    }
    if (store.status === StoreStatus.CLOSED) {
      throw storeClosed();
    }
    return store;
  }

  async findOne(id: string): Promise<StoreDetail> {
    const store = await this.prisma.hardwareStore.findUnique({
      where: { id },
      include: STORE_DETAIL_INCLUDE,
    });
    if (!store) {
      throw storeNotFound();
    }
    return toStoreDetail(store);
  }

  /**
   * Rules that need the country or several fields at once. All problems are
   * reported together, in the same shape as DTO validation errors.
   */
  private checkRegistration(
    code: string,
    dto: Pick<RegisterStoreDto, 'phone' | 'settings'>,
    managerPhoneInput?: string,
  ): { storePhone: string; amounts: StoreAmounts; managerPhone?: string } {
    const details: ValidationErrorDetail[] = [];
    const phoneOf = (value: string, field: string) => {
      const phone = isPhoneCountry(code) ? normalizePhone(value, code) : null;
      if (!phone) {
        details.push({ field, errors: [PHONE_NOT_OF_COUNTRY(code)] });
      }
      return phone;
    };

    const storePhone = phoneOf(dto.phone, 'phone');
    const managerPhone =
      managerPhoneInput === undefined
        ? undefined
        : phoneOf(managerPhoneInput, 'manager.phone');
    const amounts = {
      maxBalance: parseAmount(dto.settings.maxBalance),
      validationThreshold: parseAmount(dto.settings.validationThreshold),
      minDeposit: parseAmount(dto.settings.minDeposit),
    };
    if (amounts.minDeposit > amounts.maxBalance) {
      details.push({
        field: 'settings.minDeposit',
        errors: [MIN_DEPOSIT_ABOVE_MAX_BALANCE],
      });
    }

    if (details.length > 0 || !storePhone || managerPhone === null) {
      throw invalidFields(details);
    }
    return { storePhone, amounts, managerPhone };
  }
}
