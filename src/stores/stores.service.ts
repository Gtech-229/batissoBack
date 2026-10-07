import { Injectable } from '@nestjs/common';
import { definedOnly } from '../common/defined-only.js';
import type { ValidationErrorDetail } from '../common/errors/error-response.js';
import { parseAmount } from '../common/money.js';
import { paginated, toSkipTake, type Paginated } from '../common/pagination.js';
import { isPhoneCountry, normalizePhone } from '../common/phone.js';
import { countryNotFound } from '../countries/countries.errors.js';
import {
  Prisma,
  StoreMemberRole,
  StoreStatus,
} from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
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
  storeClosed,
  storeNotFound,
} from './stores.errors.js';

@Injectable()
export class StoresService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Registers a store as PENDING, with its settings and its first manager, in
   * one transaction: either all three exist afterwards, or none does.
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

      const { storePhone, managerPhone, amounts } = this.checkRegistration(dto);

      // An existing person (same phone) becomes the manager; their names are
      // kept, since they may already be known elsewhere. createMany with
      // skipDuplicates is one INSERT ... ON CONFLICT DO NOTHING: when a
      // concurrent registration is inserting the same phone, this waits for it
      // and skips instead of failing (an upsert would collide on the unique
      // phone and abort the transaction).
      await tx.user.createMany({
        data: [
          {
            phone: managerPhone,
            firstName: dto.manager.firstName,
            lastName: dto.manager.lastName,
          },
        ],
        skipDuplicates: true,
      });
      const manager = await tx.user.findUniqueOrThrow({
        where: { phone: managerPhone },
      });

      const store = await tx.hardwareStore.create({
        data: {
          countryCode: dto.countryCode,
          name: dto.name,
          address: dto.address,
          city: dto.city,
          phone: storePhone,
          tradeRegister: dto.tradeRegister,
          status: StoreStatus.PENDING,
          createdById: adminId,
          settings: {
            create: {
              ...amounts,
              terms: dto.settings.terms,
              updatedById: adminId,
            },
          },
          members: {
            create: { userId: manager.id, role: StoreMemberRole.MANAGER },
          },
        },
        include: STORE_DETAIL_INCLUDE,
      });
      return toStoreDetail(store);
    });
  }

  /** Newest first; filters combine with AND. */
  async list(query: ListStoresQueryDto): Promise<Paginated<StoreSummary>> {
    const where: Prisma.HardwareStoreWhereInput = {
      status: query.status,
      countryCode: query.countryCode,
      ...(query.q && {
        OR: [
          { name: { contains: query.q, mode: 'insensitive' } },
          { city: { contains: query.q, mode: 'insensitive' } },
        ],
      }),
    };
    // One transaction so the page and the total come from the same snapshot.
    const [stores, total] = await this.prisma.$transaction([
      this.prisma.hardwareStore.findMany({
        where,
        // id breaks ties between stores created in the same millisecond, so
        // pages never repeat or skip a store.
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        ...toSkipTake(query),
      }),
      this.prisma.hardwareStore.count({ where }),
    ]);
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
      where: { id, status: { in: [...transition.from] } },
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
        select: { status: true },
      });
      if (!current) {
        throw storeNotFound();
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
  private checkRegistration(dto: RegisterStoreDto) {
    const details: ValidationErrorDetail[] = [];
    const code = dto.countryCode;
    const phoneOf = (value: string, field: string) => {
      const phone = isPhoneCountry(code) ? normalizePhone(value, code) : null;
      if (!phone) {
        details.push({ field, errors: [PHONE_NOT_OF_COUNTRY(code)] });
      }
      return phone;
    };

    const storePhone = phoneOf(dto.phone, 'phone');
    const managerPhone = phoneOf(dto.manager.phone, 'manager.phone');
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

    if (details.length > 0 || !storePhone || !managerPhone) {
      throw invalidFields(details);
    }
    return { storePhone, managerPhone, amounts };
  }
}
