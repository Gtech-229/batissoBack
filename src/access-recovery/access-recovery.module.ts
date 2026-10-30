import { Module } from '@nestjs/common';
import { NotificationsModule } from '../notifications/notifications.module.js';
import { AccessRecoveryController } from './access-recovery.controller.js';
import { AccessRecoveryService } from './access-recovery.service.js';

/** Manager-triggered access reset after a lost phone (14a). */
@Module({
  imports: [NotificationsModule],
  controllers: [AccessRecoveryController],
  providers: [AccessRecoveryService],
})
export class AccessRecoveryModule {}
