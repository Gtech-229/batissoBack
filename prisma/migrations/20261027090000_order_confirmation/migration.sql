-- CreateEnum
CREATE TYPE "OrderConfirmationChannel" AS ENUM ('PIN', 'SMS_CODE');

-- AlterEnum
ALTER TYPE "GoalMovementReason" ADD VALUE 'ORDER_SHORTFALL';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "MaterialOrderStatus" ADD VALUE 'CONFIRMED';
ALTER TYPE "MaterialOrderStatus" ADD VALUE 'REFUSED_BY_CUSTOMER';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "NotificationType" ADD VALUE 'ORDER_AWAITING_CUSTOMER';
ALTER TYPE "NotificationType" ADD VALUE 'PURCHASE_RECORDED';
ALTER TYPE "NotificationType" ADD VALUE 'ORDER_REFUSED_BY_CUSTOMER';

-- AlterTable
ALTER TABLE "goal_movements" ADD COLUMN     "orderId" UUID;

-- AlterTable
ALTER TABLE "material_orders" ADD COLUMN     "confirmedAt" TIMESTAMP(3),
ADD COLUMN     "confirmedVia" "OrderConfirmationChannel",
ADD COLUMN     "customerRefusalReason" VARCHAR(500),
ADD COLUMN     "customerRefusedAt" TIMESTAMP(3),
ADD COLUMN     "operationId" UUID;

-- CreateTable
CREATE TABLE "order_confirmation_codes" (
    "id" UUID NOT NULL,
    "orderId" UUID NOT NULL,
    "codeHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "consumedAt" TIMESTAMP(3),
    "requestedById" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "order_confirmation_codes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "order_confirmation_codes_orderId_createdAt_idx" ON "order_confirmation_codes"("orderId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "material_orders_operationId_key" ON "material_orders"("operationId");

-- AddForeignKey
ALTER TABLE "material_orders" ADD CONSTRAINT "material_orders_operationId_fkey" FOREIGN KEY ("operationId") REFERENCES "operations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_confirmation_codes" ADD CONSTRAINT "order_confirmation_codes_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "material_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_confirmation_codes" ADD CONSTRAINT "order_confirmation_codes_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goal_movements" ADD CONSTRAINT "goal_movements_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "material_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;



-- Purchase debit references (A-00001): one platform-wide sequence, like
-- deposits (D-) and orders (B-). Gaps (a refused confirmation) are harmless.
CREATE SEQUENCE "operation_reference_purchase_seq" AS BIGINT START WITH 1;
