-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "ActivityAction" ADD VALUE 'PROOF_ATTACHED';
ALTER TYPE "ActivityAction" ADD VALUE 'PROOF_REMOVED';

-- CreateTable
CREATE TABLE "transaction_proofs" (
    "id" UUID NOT NULL,
    "storeId" UUID NOT NULL,
    "accountId" UUID NOT NULL,
    "operationId" UUID,
    "orderId" UUID,
    "fileName" TEXT,
    "uploadedById" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "removedAt" TIMESTAMP(3),
    "removedById" UUID,
    "removalReason" TEXT,

    CONSTRAINT "transaction_proofs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "transaction_proofs_operationId_idx" ON "transaction_proofs"("operationId");

-- CreateIndex
CREATE INDEX "transaction_proofs_orderId_idx" ON "transaction_proofs"("orderId");

-- AddForeignKey
ALTER TABLE "transaction_proofs" ADD CONSTRAINT "transaction_proofs_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "hardware_stores"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transaction_proofs" ADD CONSTRAINT "transaction_proofs_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transaction_proofs" ADD CONSTRAINT "transaction_proofs_operationId_fkey" FOREIGN KEY ("operationId") REFERENCES "operations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transaction_proofs" ADD CONSTRAINT "transaction_proofs_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "material_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transaction_proofs" ADD CONSTRAINT "transaction_proofs_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transaction_proofs" ADD CONSTRAINT "transaction_proofs_removedById_fkey" FOREIGN KEY ("removedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- A proof is about one deposit or one order, never both or neither.
ALTER TABLE "transaction_proofs" ADD CONSTRAINT "transaction_proofs_one_target"
  CHECK (num_nonnulls("operationId", "orderId") = 1);

-- Live: a file and no removal. Removed: no file, and who, when, and why.
ALTER TABLE "transaction_proofs" ADD CONSTRAINT "transaction_proofs_removal"
  CHECK (
    ("fileName" IS NOT NULL AND "removedAt" IS NULL AND "removedById" IS NULL AND "removalReason" IS NULL)
    OR
    ("fileName" IS NULL AND "removedAt" IS NOT NULL AND "removedById" IS NOT NULL AND "removalReason" IS NOT NULL)
  );
