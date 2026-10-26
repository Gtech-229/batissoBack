import { Module } from '@nestjs/common';
import { MyOrdersController } from './my-orders.controller.js';
import { OrdersController } from './orders.controller.js';
import { OrdersService } from './orders.service.js';

/** Material orders (bons de sortie): preparation and validation (feature 10a). */
@Module({
  controllers: [OrdersController, MyOrdersController],
  providers: [OrdersService],
  exports: [OrdersService],
})
export class OrdersModule {}
