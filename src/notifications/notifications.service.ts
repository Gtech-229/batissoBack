import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  NotificationChannel,
  NotificationStatus,
  NotificationType,
  Prisma,
} from '../generated/prisma/client.js';
import type { OperationWithReceipt } from '../ledger/dto/operation-receipt.js';
import type { AuthenticatedUser } from '../mobile-auth/authenticated-user.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { PUSH_SENDER, type PushSender } from '../push/push-sender.js';
import { SMS_SENDER, type SmsSender } from '../sms/sms-sender.js';
import {
  paginated,
  toSkipTake,
  type PaginationQueryDto,
} from '../common/pagination.js';
import {
  toNotificationView,
  type NotificationList,
  type NotificationView,
} from './dto/notification-view.js';
import { depositMessage } from './messages.js';
import { notificationNotFound } from './notifications.errors.js';

/** The kind of a failure, short enough for `lastError`: never its text. */
function errorKind(error: unknown): string {
  return (error instanceof Error ? error.name : 'unknown error').slice(0, 100);
}

/**
 * The notification log, as an outbox. `record...` writes the rows inside the
 * transaction of the event: a committed deposit always has its notifications,
 * a rolled-back one never has any. `dispatch` sends them after the commit,
 * outside every lock: a slow provider never holds an account.
 */
@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(SMS_SENDER) private readonly sms: SmsSender,
    @Inject(PUSH_SENDER) private readonly push: PushSender,
  ) {}

  /**
   * The rows announcing a deposit to the account's customer: the in-app item
   * (delivered as soon as it is written), an SMS, and a push per device with a
   * token. Returns the ids to dispatch once the transaction has committed.
   */
  async recordDeposit(
    tx: Prisma.TransactionClient,
    operation: OperationWithReceipt,
  ): Promise<string[]> {
    const userId = operation.account.customerId;
    const { title, body } = depositMessage({
      amount: operation.amount,
      currencyCode: operation.currencyCode,
      storeName: operation.store.name,
      accountNumber: operation.account.number,
      balanceAfter: operation.balanceAfter,
      reference: operation.reference,
    });
    const devices = await tx.userDevice.findMany({
      where: { userId, pushToken: { not: null } },
      select: { id: true },
    });
    const common = {
      userId,
      storeId: operation.storeId,
      operationId: operation.id,
      type: NotificationType.DEPOSIT_RECORDED,
      title,
      body,
    };

    await tx.notification.create({
      data: {
        ...common,
        channel: NotificationChannel.APP,
        status: NotificationStatus.SENT,
        sentAt: new Date(),
      },
    });
    const toSend = await tx.notification.createManyAndReturn({
      data: [
        { ...common, channel: NotificationChannel.SMS },
        ...devices.map((device) => ({
          ...common,
          channel: NotificationChannel.PUSH,
          deviceId: device.id,
        })),
      ],
      select: { id: true },
    });
    return toSend.map((row) => row.id);
  }

  /**
   * The user's in-app list, newest first: the APP rows only (the SMS and push
   * rows of the same message are delivery records). The page, the total, and
   * the unread count come from one snapshot.
   */
  async list(
    userId: string,
    query: PaginationQueryDto,
  ): Promise<NotificationList> {
    const where = { userId, channel: NotificationChannel.APP };
    const [rows, total, unreadCount] = await this.prisma.$transaction([
      this.prisma.notification.findMany({
        where,
        // id breaks ties within one millisecond (uuid v7 is time-ordered).
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        ...toSkipTake(query),
      }),
      this.prisma.notification.count({ where }),
      this.prisma.notification.count({ where: { ...where, readAt: null } }),
    ]);
    return {
      ...paginated(rows.map(toNotificationView), total, query),
      unreadCount,
    };
  }

  /**
   * Marks one of the user's in-app notifications read. Idempotent: reading it
   * again keeps the first date. Anyone else's notification is a 404.
   */
  async markRead(
    userId: string,
    notificationId: string,
  ): Promise<NotificationView> {
    const where = {
      id: notificationId,
      userId,
      channel: NotificationChannel.APP,
    };
    await this.prisma.notification.updateMany({
      where: { ...where, readAt: null },
      data: { readAt: new Date() },
    });
    const row = await this.prisma.notification.findFirst({ where });
    if (!row) {
      throw notificationNotFound();
    }
    return toNotificationView(row);
  }

  /**
   * Stores the push token of the session's device, or removes it (`null`). A
   * token is unique: one already on another device (a phone that changed
   * hands, or a reinstalled app) is taken off it first, in the same transaction,
   * so pushes only ever reach the phone's current user.
   */
  async setPushToken(
    actor: AuthenticatedUser,
    token: string | null,
  ): Promise<void> {
    const write = () =>
      this.prisma.$transaction(async (tx) => {
        if (token !== null) {
          await tx.userDevice.updateMany({
            where: {
              pushToken: token,
              NOT: { userId: actor.userId, deviceId: actor.deviceId },
            },
            data: { pushToken: null },
          });
        }
        await tx.userDevice.update({
          where: {
            userId_deviceId: {
              userId: actor.userId,
              deviceId: actor.deviceId,
            },
          },
          data: { pushToken: token },
        });
      });
    try {
      await write();
    } catch (error) {
      // Two installations claimed the same token at the same moment: the
      // unique index refused one; once more, the other's claim is visible.
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        await write();
        return;
      }
      throw error;
    }
  }

  /**
   * Sends PENDING rows, one after the other, and records each outcome. Never
   * throws: the caller does not wait for it (the answer has already gone), so
   * every failure, even of the database, ends in the log.
   */
  async dispatch(ids: string[]): Promise<void> {
    for (const id of ids) {
      try {
        await this.send(id);
      } catch (error) {
        this.logger.error(
          `Notification ${id} could not be dispatched (${errorKind(error)})`,
        );
      }
    }
  }

  private async send(id: string): Promise<void> {
    const row = await this.prisma.notification.findUnique({
      where: { id },
      include: {
        user: { select: { phone: true } },
        device: { select: { pushToken: true } },
      },
    });
    if (row?.status !== NotificationStatus.PENDING) {
      return;
    }
    try {
      if (row.channel === NotificationChannel.SMS) {
        await this.sms.send(row.user.phone, row.body);
      } else if (row.channel === NotificationChannel.PUSH) {
        const token = row.device?.pushToken;
        if (!token) {
          // The device went, or its token was removed, since the row was written.
          throw Object.assign(new Error('No push token'), {
            name: 'NoPushToken',
          });
        }
        await this.push.send(token, { title: row.title, body: row.body });
      }
    } catch (error) {
      const kind = errorKind(error);
      await this.prisma.notification.update({
        where: { id },
        data: {
          status: NotificationStatus.FAILED,
          attempts: { increment: 1 },
          lastError: kind,
        },
      });
      // The id only: never the phone, the token, or the text.
      this.logger.warn(`Notification ${id} failed (${kind})`);
      return;
    }
    await this.prisma.notification.update({
      where: { id },
      data: {
        status: NotificationStatus.SENT,
        attempts: { increment: 1 },
        sentAt: new Date(),
        lastError: null,
      },
    });
  }
}
