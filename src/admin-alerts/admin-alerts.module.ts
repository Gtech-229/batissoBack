import { Module } from '@nestjs/common';
import { NotificationsModule } from '../notifications/notifications.module.js';
import { SystemSettingsModule } from '../system-settings/system-settings.module.js';
import { AdminAlertsController } from './admin-alerts.controller.js';
import { AdminAlertsService } from './admin-alerts.service.js';
import { BalanceCheckJob } from './balance-check.job.js';
import { BalanceCheckService } from './balance-check.service.js';
import { DeliveryAlertsJob } from './delivery-alerts.job.js';
import { DeliveryAlertsService } from './delivery-alerts.service.js';

/**
 * Scheduled jobs and what they find: the nightly balance check (17a) and the
 * delivery alerts (17b); admins list and resolve the alerts.
 */
@Module({
  imports: [NotificationsModule, SystemSettingsModule],
  controllers: [AdminAlertsController],
  providers: [
    BalanceCheckService,
    BalanceCheckJob,
    AdminAlertsService,
    DeliveryAlertsService,
    DeliveryAlertsJob,
  ],
})
export class AdminAlertsModule {}
