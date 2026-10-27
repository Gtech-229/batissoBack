import { Module } from '@nestjs/common';
import { MobileAuthModule } from '../mobile-auth/mobile-auth.module.js';
import { NotificationsModule } from '../notifications/notifications.module.js';
import { SmsModule } from '../sms/sms.module.js';
import { ConfirmationCodesService } from './confirmation-codes.service.js';
import { MyOrdersController } from './my-orders.controller.js';
import { OrderConfirmationService } from './order-confirmation.service.js';
import { OrdersController } from './orders.controller.js';
import { OrdersService } from './orders.service.js';

/**
 * Material orders (bons de sortie): preparation and validation (10a), the
 * customer's confirmation and the debit (10b). MobileAuthModule gives the PIN
 * check.
 */
@Module({
  imports: [MobileAuthModule, SmsModule, NotificationsModule],
  controllers: [OrdersController, MyOrdersController],
  providers: [
    OrdersService,
    OrderConfirmationService,
    ConfirmationCodesService,
  ],
  exports: [OrdersService],
})
export class OrdersModule {}
