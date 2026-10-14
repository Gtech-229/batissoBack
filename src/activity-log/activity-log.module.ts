import { Module } from '@nestjs/common';
import { ActivityLogController } from './activity-log.controller.js';
import { ActivityLogService } from './activity-log.service.js';

/** Reading a store's activity log. Features write their entries themselves, in their transactions. */
@Module({
  controllers: [ActivityLogController],
  providers: [ActivityLogService],
})
export class ActivityLogModule {}
