import { Injectable } from '@nestjs/common';
import { ActivityAction, StoreStatus } from '../generated/prisma/client.js';
import type { AuthenticatedUser } from '../mobile-auth/authenticated-user.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { storeClosed } from '../stores/stores.errors.js';
import type { QrCodeView } from './dto/qr-code.dto.js';
import { newQrCode } from './qr-code.js';

/**
 * The QR codes of users and stores (feature 23). A code is created on first
 * read and stays valid until it is regenerated. Codes never go into a log, an
 * activity row, a notification, or an error message.
 */
@Injectable()
export class QrCodesService {
  constructor(private readonly prisma: PrismaService) {}

  /** The session user's code, created on first read. */
  async myCode(userId: string): Promise<QrCodeView> {
    // Only where none exists yet: two first reads at once both end up with the
    // code the first one wrote (the second update waits, then matches nothing).
    await this.prisma.user.updateMany({
      where: { id: userId, qrCode: null },
      data: { qrCode: newQrCode() },
    });
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { qrCode: true },
    });
    return { code: user.qrCode! };
  }

  /** Replaces the session user's code: the old one stops resolving at once. */
  async regenerateMine(userId: string): Promise<QrCodeView> {
    const user = await this.prisma.user.update({
      where: { id: userId },
      data: { qrCode: newQrCode() },
      select: { qrCode: true },
    });
    return { code: user.qrCode! };
  }

  /** The store's code, created on first read; readable in every store status. */
  async storeCode(storeId: string): Promise<QrCodeView> {
    // Same race-safe creation as for a user.
    await this.prisma.hardwareStore.updateMany({
      where: { id: storeId, qrCode: null },
      data: { qrCode: newQrCode() },
    });
    const store = await this.prisma.hardwareStore.findUniqueOrThrow({
      where: { id: storeId },
      select: { qrCode: true },
    });
    return { code: store.qrCode! };
  }

  /**
   * Replaces the store's code (a manager's change: refused in a CLOSED store),
   * with its activity log row in the same transaction. The row records that
   * the code changed, never the code itself.
   *
   * One conditional write, as for store status changes: the row lock it takes
   * orders it with a concurrent closing or regeneration. (A `FOR SHARE` read
   * followed by this update would deadlock two parallel regenerations.)
   */
  async regenerateStore(
    storeId: string,
    actor: AuthenticatedUser,
  ): Promise<QrCodeView> {
    return this.prisma.$transaction(async (tx) => {
      const code = newQrCode();
      const { count } = await tx.hardwareStore.updateMany({
        where: { id: storeId, status: { not: StoreStatus.CLOSED } },
        data: { qrCode: code },
      });
      if (count === 0) {
        // The guard found the store: it exists, so it is closed.
        throw storeClosed();
      }
      await tx.activityLog.create({
        data: {
          storeId,
          userId: actor.userId,
          action: ActivityAction.STORE_QR_CODE_REGENERATED,
          device: actor.deviceId,
        },
      });
      return { code };
    });
  }
}
