-- AlterEnum
ALTER TYPE "GoalMovementReason" ADD VALUE 'ORDER_CANCELLATION';

-- AlterEnum
ALTER TYPE "MaterialOrderStatus" ADD VALUE 'CANCELLED_AFTER_DEBIT';

-- AlterEnum
ALTER TYPE "NotificationType" ADD VALUE 'ORDER_CANCELLED_AFTER_DEBIT';

-- AlterTable
ALTER TABLE "material_orders" ADD COLUMN     "recreditOperationId" UUID;

-- CreateIndex
CREATE UNIQUE INDEX "material_orders_recreditOperationId_key" ON "material_orders"("recreditOperationId");

-- AddForeignKey
ALTER TABLE "material_orders" ADD CONSTRAINT "material_orders_recreditOperationId_fkey" FOREIGN KEY ("recreditOperationId") REFERENCES "operations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- A paid order is re-credited once (11b): at most one CREDIT correction per
-- corrected operation. Deposit corrections (11a) are DEBITs, so a deposit can
-- still have several.
CREATE UNIQUE INDEX "operations_one_recredit_per_operation"
  ON "operations" ("correctedOperationId")
  WHERE "direction" = 'CREDIT';
