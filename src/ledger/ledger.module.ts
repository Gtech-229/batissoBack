import { Module } from '@nestjs/common';
import { DepositsController } from './deposits.controller.js';
import { MyOperationsController } from './my-operations.controller.js';
import { OperationsController } from './operations.controller.js';
import { LedgerService } from './ledger.service.js';

/** The append-only ledger: deposits and history now; debits, corrections later. */
@Module({
  controllers: [
    DepositsController,
    OperationsController,
    MyOperationsController,
  ],
  providers: [LedgerService],
})
export class LedgerModule {}
