import { Module } from '@nestjs/common';
import { CashClosingsController } from './cash-closings.controller.js';
import { CashClosingsService } from './cash-closings.service.js';

/** Daily cash closing (feature 13): the manager counts the store's cash. */
@Module({
  controllers: [CashClosingsController],
  providers: [CashClosingsService],
})
export class CashClosingsModule {}
