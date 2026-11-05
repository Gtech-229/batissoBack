import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { DeliveryAlertsService } from './delivery-alerts.service.js';

/** The job's name in the SchedulerRegistry. */
export const DELIVERY_ALERTS_JOB = 'delivery-alerts';

/**
 * Runs the delivery alerts every hour, at minute 0 UTC (17b): an alert is at
 * most an hour late. One API instance in V1, and each order is claimed before
 * it is alerted, so an overlapping run cannot alert twice.
 */
@Injectable()
export class DeliveryAlertsJob {
  private readonly logger = new Logger(DeliveryAlertsJob.name);

  constructor(private readonly alerts: DeliveryAlertsService) {}

  @Cron('0 * * * *', { name: DELIVERY_ALERTS_JOB, timeZone: 'UTC' })
  async handle(): Promise<void> {
    const now = new Date();
    try {
      const { ordersAlerted } = await this.alerts.alertOverdueDeliveries(now);
      const { requestsEscalated } =
        await this.alerts.escalateUnansweredCancellations(now);
      // Counts only: never an order, an account or a person.
      this.logger.log(
        `Delivery alerts: ${ordersAlerted} orders alerted, ${requestsEscalated} cancellation requests escalated`,
      );
    } catch (error) {
      // The message only; the next hour runs again.
      const message = error instanceof Error ? error.message : 'unknown error';
      this.logger.error(`Delivery alerts failed: ${message}`);
    }
  }
}
