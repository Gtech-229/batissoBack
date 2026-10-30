import { Injectable } from '@nestjs/common';
import { accountNotFound } from '../accounts/accounts.errors.js';
import { ActivityAction } from '../generated/prisma/client.js';
import { sellerNotFound } from '../staff/staff.errors.js';
import type { AuthenticatedUser } from '../mobile-auth/authenticated-user.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type { CurrentStoreContext } from '../store-access/current-store.js';
import { managerResetNotAllowed } from './access-recovery.errors.js';
import type { AccessResetView } from './dto/access-reset-view.js';

/**
 * A manager resets a person's access after a lost phone or a forgotten PIN
 * (14a). The reset applies to the person everywhere: they sign in again with an
 * SMS code and choose a new PIN, as at activation.
 */
@Injectable()
export class AccessRecoveryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  /** Resets the holder of an account of this store. */
  async resetAccountHolder(
    store: CurrentStoreContext,
    actor: AuthenticatedUser,
    accountId: string,
  ): Promise<AccessResetView> {
    const account = await this.prisma.account.findFirst({
      where: { id: accountId, storeId: store.storeId },
      select: { customerId: true },
    });
    if (!account) {
      throw accountNotFound();
    }
    return this.reset(store, actor, account.customerId);
  }

  /**
   * Resets a member of this store's team, active or not. An active manager is
   * refused by `reset`, like every other path to one.
   */
  async resetSeller(
    store: CurrentStoreContext,
    actor: AuthenticatedUser,
    userId: string,
  ): Promise<AccessResetView> {
    const member = await this.prisma.storeMember.findUnique({
      where: { userId_storeId: { userId, storeId: store.storeId } },
      select: { id: true },
    });
    if (!member) {
      throw sellerNotFound();
    }
    return this.reset(store, actor, userId);
  }

  private async reset(
    store: CurrentStoreContext,
    actor: AuthenticatedUser,
    userId: string,
  ): Promise<AccessResetView> {
    const { view, notificationIds } = await this.prisma.$transaction(
      async (tx) => {
        const managerships = await tx.storeMember.count({
          where: { userId, role: 'MANAGER', active: true },
        });
        if (managerships > 0) {
          throw managerResetNotAllowed();
        }
        const user = await tx.user.findUniqueOrThrow({
          where: { id: userId },
          select: { phone: true, firstName: true, lastName: true },
        });
        const { name: storeName } = await tx.hardwareStore.findUniqueOrThrow({
          where: { id: store.storeId },
          select: { name: true },
        });

        const resetAt = new Date();
        // Before the user lock, the order of POST /auth/pin (token, then user):
        // the two cannot deadlock, and a token in flight dies here.
        await tx.phoneVerification.updateMany({
          where: { phone: user.phone, consumedAt: null },
          data: { consumedAt: resetAt },
        });
        // Under this lock: a sign-in that passed its PIN check has committed its
        // session, so it is revoked below; a later one sees the hash is gone.
        await tx.$queryRaw`
          SELECT 1 FROM "users" WHERE "id" = ${userId}::uuid FOR UPDATE`;
        await tx.user.update({
          where: { id: userId },
          data: { pinHash: null, failedPinAttempts: 0, pinLockedUntil: null },
        });
        const { count: sessionsRevoked } = await tx.userSession.updateMany({
          where: { userId, revokedAt: null },
          data: { revokedAt: resetAt },
        });
        // Rows are kept: sessions and notifications refer to them, and the next
        // SMS sign-in sets a new key.
        const { count: devicesUntrusted } = await tx.userDevice.updateMany({
          where: {
            userId,
            OR: [{ publicKey: { not: null } }, { pushToken: { not: null } }],
          },
          data: { publicKey: null, pushToken: null },
        });

        await tx.activityLog.create({
          data: {
            storeId: store.storeId,
            userId: actor.userId,
            action: ActivityAction.ACCESS_RESET,
            newValue: {
              targetUserId: userId,
              sessionsRevoked,
              devicesUntrusted,
            },
            device: actor.deviceId,
          },
        });
        const notificationIds = await this.notifications.recordAccessReset(tx, {
          userId,
          storeId: store.storeId,
          storeName,
        });
        return {
          view: {
            firstName: user.firstName,
            lastName: user.lastName,
            resetAt,
            sessionsRevoked,
            devicesUntrusted,
          },
          notificationIds,
        };
      },
    );
    void this.notifications.dispatch(notificationIds);
    return view;
  }
}
