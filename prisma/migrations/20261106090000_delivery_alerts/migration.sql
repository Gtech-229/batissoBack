-- AlterEnum
ALTER TYPE "AdminAlertType" ADD VALUE 'ORDER_CANCELLATION_UNANSWERED';

-- AlterEnum
ALTER TYPE "NotificationType" ADD VALUE 'ORDER_DELIVERY_OVERDUE';

-- AlterTable
ALTER TABLE "admin_alerts" ADD COLUMN     "orderId" UUID,
ALTER COLUMN "difference" DROP NOT NULL;

-- AlterTable
ALTER TABLE "material_orders" ADD COLUMN     "cancellationEscalatedAt" TIMESTAMP(3),
ADD COLUMN     "deliveryAlertedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "system_settings" ADD COLUMN     "cancellationEscalationHours" INTEGER NOT NULL DEFAULT 48,
ADD COLUMN     "deliveryAlertDays" INTEGER NOT NULL DEFAULT 7;

-- AddForeignKey
ALTER TABLE "admin_alerts" ADD CONSTRAINT "admin_alerts_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "material_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- The delays' ranges, also enforced by the settings DTO.
ALTER TABLE "system_settings" ADD CONSTRAINT "system_settings_delivery_alert_days_check" CHECK ("deliveryAlertDays" BETWEEN 1 AND 365);
ALTER TABLE "system_settings" ADD CONSTRAINT "system_settings_cancellation_escalation_hours_check" CHECK ("cancellationEscalationHours" BETWEEN 1 AND 720);

-- One unresolved alert per type, account, goal and order (17b adds the order).
DROP INDEX "admin_alerts_one_open_per_target";
CREATE UNIQUE INDEX "admin_alerts_one_open_per_target" ON "admin_alerts"("type", "accountId", COALESCE("goalId", '00000000-0000-0000-0000-000000000000'::uuid), COALESCE("orderId", '00000000-0000-0000-0000-000000000000'::uuid)) WHERE "resolvedAt" IS NULL;
