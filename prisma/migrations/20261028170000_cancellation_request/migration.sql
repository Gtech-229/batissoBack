-- AlterEnum
ALTER TYPE "NotificationType" ADD VALUE 'ORDER_CANCELLATION_REQUESTED';

-- AlterTable
ALTER TABLE "material_orders" ADD COLUMN     "cancellationRequestReason" VARCHAR(500),
ADD COLUMN     "cancellationRequestedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "store_settings" ADD COLUMN     "deliveryDelayDays" INTEGER NOT NULL DEFAULT 30;


-- The delivery delay is a whole number of days, 1 to 365 (11c).
ALTER TABLE "store_settings" ADD CONSTRAINT "store_settings_delivery_delay_check"
  CHECK ("deliveryDelayDays" BETWEEN 1 AND 365);
