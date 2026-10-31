import { Module } from '@nestjs/common';
import { MyProofsController } from './my-proofs.controller.js';
import { ProofStorage } from './proof-storage.js';
import { StoreProofsController } from './store-proofs.controller.js';
import { TransactionProofsService } from './transaction-proofs.service.js';

/** Photos of the paper behind a transaction, kept in the private `PROOF_DIR`. */
@Module({
  controllers: [StoreProofsController, MyProofsController],
  providers: [ProofStorage, TransactionProofsService],
})
export class TransactionProofsModule {}
