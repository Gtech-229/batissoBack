import { Module } from '@nestjs/common';
import { NotificationsModule } from '../notifications/notifications.module.js';
import { CorrectionsController } from './corrections.controller.js';
import { CorrectionsService } from './corrections.service.js';
import { DepositsController } from './deposits.controller.js';
import { MyOperationsController } from './my-operations.controller.js';
import { OperationsController } from './operations.controller.js';
import { LedgerService } from './ledger.service.js';

/** The append-only ledger: deposits, corrections (11a), and history. */
@Module({
  imports: [NotificationsModule],
  controllers: [
    DepositsController,
    CorrectionsController,
    OperationsController,
    MyOperationsController,
  ],
  providers: [LedgerService, CorrectionsService],
})
export class LedgerModule {}
