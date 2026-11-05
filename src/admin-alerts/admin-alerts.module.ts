import { Module } from '@nestjs/common';
import { AdminAlertsController } from './admin-alerts.controller.js';
import { AdminAlertsService } from './admin-alerts.service.js';
import { BalanceCheckJob } from './balance-check.job.js';
import { BalanceCheckService } from './balance-check.service.js';

/** Problems found by scheduled jobs, listed and resolved by admins (17a). */
@Module({
  controllers: [AdminAlertsController],
  providers: [BalanceCheckService, BalanceCheckJob, AdminAlertsService],
})
export class AdminAlertsModule {}
