import { Module } from '@nestjs/common';
import { ActivityLogController } from './activity-log.controller.js';
import { ActivityLogService } from './activity-log.service.js';
import { AdminActivityController } from './admin-activity.controller.js';

/**
 * Reading a store's activity log, and every store's for admins (16c). Features
 * write their entries themselves, in their transactions.
 */
@Module({
  controllers: [ActivityLogController, AdminActivityController],
  providers: [ActivityLogService],
})
export class ActivityLogModule {}
