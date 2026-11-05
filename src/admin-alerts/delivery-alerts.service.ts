import { Injectable, Logger } from '@nestjs/common';
import {
  AdminAlertType,
  MaterialOrderStatus,
  StoreStatus,
} from '../generated/prisma/client.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { SystemSettingsService } from '../system-settings/system-settings.service.js';

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

/**
 * The delivery alerts of paid orders (17b), run every hour. Each order is
 * alerted once: a conditional update claims it in the same transaction that
 * writes its alert, so two runs can never alert twice. The delays are the
 * platform settings, read on every run.
 */
@Injectable()
export class DeliveryAlertsService {
  private readonly logger = new Logger(DeliveryAlertsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    private readonly settings: SystemSettingsService,
  ) {}

  /**
   * Alerts the managers of each confirmed order still undelivered after
   * `deliveryAlertDays`. A CLOSED store is skipped: its managers can no longer
   * act. A failure on one order does not stop the others.
   */
  async alertOverdueDeliveries(
    now: Date = new Date(),
  ): Promise<{ ordersAlerted: number }> {
    const { deliveryAlertDays } = await this.settings.get();
    const cutoff = new Date(now.getTime() - deliveryAlertDays * DAY_MS);
    const orders = await this.prisma.materialOrder.findMany({
      where: {
        status: MaterialOrderStatus.CONFIRMED,
        confirmedAt: { lte: cutoff },
        deliveryAlertedAt: null,
        store: { status: { not: StoreStatus.CLOSED } },
      },
      select: {
        id: true,
        storeId: true,
        reference: true,
        total: true,
        confirmedAt: true,
        account: { select: { number: true, currencyCode: true } },
      },
      orderBy: { confirmedAt: 'asc' },
    });

    let ordersAlerted = 0;
    for (const order of orders) {
      try {
        const ids = await this.prisma.$transaction(async (tx) => {
          // The claim: only a still-CONFIRMED, not-yet-alerted order matches,
          // so a parallel run, or a delivery in between, makes it a no-op.
          const { count } = await tx.materialOrder.updateMany({
            where: {
              id: order.id,
              status: MaterialOrderStatus.CONFIRMED,
              deliveryAlertedAt: null,
            },
            data: { deliveryAlertedAt: now },
          });
          if (count === 0) {
            return null;
          }
          return this.notifications.recordDeliveryOverdue(tx, {
            storeId: order.storeId,
            accountNumber: order.account.number,
            orderReference: order.reference,
            total: order.total,
            currencyCode: order.account.currencyCode,
            days: Math.floor(
              (now.getTime() - order.confirmedAt!.getTime()) / DAY_MS,
            ),
          });
        });
        if (ids) {
          ordersAlerted += 1;
          void this.notifications.dispatch(ids);
        }
      } catch (error) {
        // The message only: no order, account or person in the log.
        const message = error instanceof Error ? error.message : 'unknown';
        this.logger.error(`A delivery alert failed: ${message}`);
      }
    }
    return { ordersAlerted };
  }

  /**
   * Turns each cancellation request left unanswered for
   * `cancellationEscalationHours` into one admin alert. Unanswered: the order
   * is still CONFIRMED (neither delivered nor cancelled after debit). Every
   * store status: the admin is the escalation.
   */
  async escalateUnansweredCancellations(
    now: Date = new Date(),
  ): Promise<{ requestsEscalated: number }> {
    const { cancellationEscalationHours } = await this.settings.get();
    const cutoff = new Date(
      now.getTime() - cancellationEscalationHours * HOUR_MS,
    );
    const orders = await this.prisma.materialOrder.findMany({
      where: {
        status: MaterialOrderStatus.CONFIRMED,
        cancellationRequestedAt: { lte: cutoff },
        cancellationEscalatedAt: null,
      },
      select: { id: true, storeId: true, accountId: true },
      orderBy: { cancellationRequestedAt: 'asc' },
    });

    let requestsEscalated = 0;
    for (const order of orders) {
      try {
        const escalated = await this.prisma.$transaction(async (tx) => {
          // The same claim as for delivery alerts: once, even in parallel.
          const { count } = await tx.materialOrder.updateMany({
            where: {
              id: order.id,
              status: MaterialOrderStatus.CONFIRMED,
              cancellationEscalatedAt: null,
            },
            data: { cancellationEscalatedAt: now },
          });
          if (count === 0) {
            return false;
          }
          await tx.adminAlert.create({
            data: {
              type: AdminAlertType.ORDER_CANCELLATION_UNANSWERED,
              storeId: order.storeId,
              accountId: order.accountId,
              orderId: order.id,
            },
          });
          return true;
        });
        if (escalated) {
          requestsEscalated += 1;
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : 'unknown';
        this.logger.error(`A cancellation escalation failed: ${message}`);
      }
    }
    return { requestsEscalated };
  }
}
