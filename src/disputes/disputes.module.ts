import { Module } from '@nestjs/common';
import { NotificationsModule } from '../notifications/notifications.module.js';
import { AdminDisputesController } from './admin-disputes.controller.js';
import { DisputesController } from './disputes.controller.js';
import { DisputesService } from './disputes.service.js';
import { MyDisputesController } from './my-disputes.controller.js';

/**
 * Disputes (feature 12): a customer contests an operation, in a thread with the
 * manager. Admins read the unresolved ones of every store (16c).
 */
@Module({
  imports: [NotificationsModule],
  controllers: [
    MyDisputesController,
    DisputesController,
    AdminDisputesController,
  ],
  providers: [DisputesService],
})
export class DisputesModule {}
