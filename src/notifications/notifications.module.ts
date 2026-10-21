import { Module } from '@nestjs/common';
import { PushModule } from '../push/push.module.js';
import { SmsModule } from '../sms/sms.module.js';
import { MyDevicesController } from './my-devices.controller.js';
import { MyNotificationsController } from './my-notifications.controller.js';
import { NotificationsService } from './notifications.service.js';

/** The notification log and its senders (SMS, push); each event's feature calls it. */
@Module({
  imports: [SmsModule, PushModule],
  controllers: [MyDevicesController, MyNotificationsController],
  providers: [NotificationsService],
  exports: [NotificationsService],
})
export class NotificationsModule {}
