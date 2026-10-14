import { Injectable } from '@nestjs/common';
import { isPhoneCountry, normalizePhone } from '../common/phone.js';
import {
  ActivityAction,
  StoreMemberRole,
  StoreStatus,
  type Prisma,
} from '../generated/prisma/client.js';
import type { AuthenticatedUser } from '../mobile-auth/authenticated-user.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type { CurrentStoreContext } from '../store-access/current-store.js';
import {
  invalidFields,
  PHONE_NOT_OF_COUNTRY,
  storeNotFound,
} from '../stores/stores.errors.js';
import { toStoreMemberView, type StoreMemberView } from './dto/store-member.js';
import type { AddSellerDto } from './dto/add-seller.dto.js';
import {
  alreadyActive,
  alreadyInactive,
  alreadyMember,
  sellerNotFound,
  storeNotVerified,
} from './staff.errors.js';

type Tx = Prisma.TransactionClient;

export interface AddSellerResult {
  member: StoreMemberView;
  /** False when an inactive seller was reactivated instead. */
  created: boolean;
}

/**
 * A store's team, managed by its managers. The store always comes from the
 * guard's context (the URL's store, checked against the caller's membership),
 * never from a body. Every change writes its activity log row in the same
 * transaction, so the log cannot miss or invent a change.
 */
@Injectable()
export class StaffService {
  constructor(private readonly prisma: PrismaService) {}

  /** Managers first, then sellers, oldest first; inactive sellers included. */
  async members(storeId: string): Promise<StoreMemberView[]> {
    const members = await this.prisma.storeMember.findMany({
      where: { storeId },
      include: { user: true },
      // The enum is declared SELLER, MANAGER: descending puts managers first.
      orderBy: [{ role: 'desc' }, { createdAt: 'asc' }],
    });
    return members.map(toStoreMemberView);
  }

  /**
   * Adds a seller by phone. A phone with no user yet creates one (names from
   * the manager, no PIN: the seller activates the app by SMS code); an existing
   * user keeps their names. A former seller of this store is reactivated.
   */
  async addSeller(
    store: CurrentStoreContext,
    actor: AuthenticatedUser,
    dto: AddSellerDto,
  ): Promise<AddSellerResult> {
    return this.prisma.$transaction(async (tx) => {
      const countryCode = await this.lockVerifiedStore(tx, store.storeId);
      const phone = isPhoneCountry(countryCode)
        ? normalizePhone(dto.phone, countryCode)
        : null;
      if (!phone) {
        throw invalidFields([
          { field: 'phone', errors: [PHONE_NOT_OF_COUNTRY(countryCode)] },
        ]);
      }

      // ON CONFLICT DO NOTHING, then read: race-safe, unlike an upsert (F-07).
      await tx.user.createMany({
        data: [{ phone, firstName: dto.firstName, lastName: dto.lastName }],
        skipDuplicates: true,
      });
      const user = await tx.user.findUniqueOrThrow({ where: { phone } });
      const key = {
        userId_storeId: { userId: user.id, storeId: store.storeId },
      };

      // Same pattern for the membership: a parallel add of the same phone waits
      // here for the first one, then finds its row and is refused.
      const { count: created } = await tx.storeMember.createMany({
        data: [
          {
            userId: user.id,
            storeId: store.storeId,
            role: StoreMemberRole.SELLER,
          },
        ],
        skipDuplicates: true,
      });
      if (created === 0) {
        // Only an inactive seller can come back; a manager or an active seller
        // is already in the team. Conditional, so two reactivations cannot both win.
        const { count: reactivated } = await tx.storeMember.updateMany({
          where: {
            userId: user.id,
            storeId: store.storeId,
            role: StoreMemberRole.SELLER,
            active: false,
          },
          data: { active: true },
        });
        if (reactivated === 0) {
          throw alreadyMember();
        }
      }

      await this.log(tx, store, actor, {
        action: created
          ? ActivityAction.SELLER_ADDED
          : ActivityAction.SELLER_REACTIVATED,
        oldValue: created ? undefined : { userId: user.id, active: false },
        newValue: created
          ? {
              userId: user.id,
              firstName: user.firstName,
              lastName: user.lastName,
              phone: user.phone,
              role: StoreMemberRole.SELLER,
            }
          : { userId: user.id, active: true },
      });

      const member = await tx.storeMember.findUniqueOrThrow({
        where: key,
        include: { user: true },
      });
      return { member: toStoreMemberView(member), created: created === 1 };
    });
  }

  /**
   * Deactivates (`active: false`) or reactivates a seller. A deactivated seller
   * keeps their account; the store guard refuses them from their next request.
   */
  async setSellerActive(
    store: CurrentStoreContext,
    actor: AuthenticatedUser,
    userId: string,
    active: boolean,
  ): Promise<StoreMemberView> {
    return this.prisma.$transaction(async (tx) => {
      await this.lockVerifiedStore(tx, store.storeId);

      // One conditional write: only a seller of this store, in the other state.
      const { count } = await tx.storeMember.updateMany({
        where: {
          userId,
          storeId: store.storeId,
          role: StoreMemberRole.SELLER,
          active: !active,
        },
        data: { active },
      });
      if (count === 0) {
        const current = await tx.storeMember.findUnique({
          where: { userId_storeId: { userId, storeId: store.storeId } },
          select: { role: true },
        });
        // A manager is not a seller: same answer as an unknown id.
        if (current?.role !== StoreMemberRole.SELLER) {
          throw sellerNotFound();
        }
        throw active ? alreadyActive() : alreadyInactive();
      }

      await this.log(tx, store, actor, {
        action: active
          ? ActivityAction.SELLER_REACTIVATED
          : ActivityAction.SELLER_DEACTIVATED,
        oldValue: { userId, active: !active },
        newValue: { userId, active },
      });

      const member = await tx.storeMember.findUniqueOrThrow({
        where: { userId_storeId: { userId, storeId: store.storeId } },
        include: { user: true },
      });
      return toStoreMemberView(member);
    });
  }

  /**
   * Reads the store `FOR SHARE` and requires it VERIFIED: a concurrent status
   * change (which locks the row) waits for this team change, or the reverse,
   * so a team never changes in a store that was just suspended or closed.
   */
  private async lockVerifiedStore(tx: Tx, storeId: string): Promise<string> {
    const [row] = await tx.$queryRaw<
      { status: StoreStatus; countryCode: string }[]
    >`SELECT "status", "countryCode" FROM "hardware_stores" WHERE "id" = ${storeId}::uuid FOR SHARE`;
    if (!row) {
      throw storeNotFound();
    }
    if (row.status !== StoreStatus.VERIFIED) {
      throw storeNotVerified(row.status);
    }
    return row.countryCode;
  }

  private log(
    tx: Tx,
    store: CurrentStoreContext,
    actor: AuthenticatedUser,
    entry: {
      action: ActivityAction;
      oldValue?: Prisma.InputJsonValue;
      newValue?: Prisma.InputJsonValue;
    },
  ) {
    return tx.activityLog.create({
      data: {
        storeId: store.storeId,
        userId: actor.userId,
        action: entry.action,
        oldValue: entry.oldValue,
        newValue: entry.newValue,
        device: actor.deviceId,
      },
    });
  }
}
