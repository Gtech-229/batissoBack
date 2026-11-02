import { Module } from '@nestjs/common';
import { StoreReportsController } from './store-reports.controller.js';
import { StoreReportsService } from './store-reports.service.js';

/** A store's reports for its manager (15a). */
@Module({
  controllers: [StoreReportsController],
  providers: [StoreReportsService],
})
export class StoreReportsModule {}
