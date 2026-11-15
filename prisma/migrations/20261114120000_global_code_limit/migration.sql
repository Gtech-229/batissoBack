-- AlterEnum
ALTER TYPE "AdminAlertType" ADD VALUE 'CODE_LIMIT_REACHED';

-- AlterTable
ALTER TABLE "system_settings" ADD COLUMN     "maxCodesPerDay" INTEGER NOT NULL DEFAULT 200,
ADD COLUMN     "maxCodesPerHour" INTEGER NOT NULL DEFAULT 50;

-- AlterTable
ALTER TABLE "admin_alerts" ALTER COLUMN "storeId" DROP NOT NULL,
ALTER COLUMN "accountId" DROP NOT NULL;

-- CreateIndex
CREATE INDEX "phone_verifications_createdAt_idx" ON "phone_verifications"("createdAt");


-- The code caps' ranges (25a), also enforced by the settings DTO.
ALTER TABLE "system_settings" ADD CONSTRAINT "system_settings_max_codes_per_hour_check" CHECK ("maxCodesPerHour" BETWEEN 1 AND 10000);
ALTER TABLE "system_settings" ADD CONSTRAINT "system_settings_max_codes_per_day_check" CHECK ("maxCodesPerDay" BETWEEN 1 AND 100000);

-- A code-limit alert has neither store nor account; every other alert has
-- both. The type is compared as text: PostgreSQL refuses to use an enum value
-- added in the same transaction.
ALTER TABLE "admin_alerts" ADD CONSTRAINT "admin_alerts_target_check" CHECK (("type"::text = 'CODE_LIMIT_REACHED') = ("storeId" IS NULL AND "accountId" IS NULL));

-- One unresolved code-limit alert at a time (the per-target index does not
-- cover it: its accountId is NULL, and NULLs never conflict). "storeId" IS NULL
-- means CODE_LIMIT_REACHED by the CHECK above; an index condition cannot cast
-- the enum (not immutable), nor use a value added in the same transaction.
CREATE UNIQUE INDEX "admin_alerts_one_open_code_limit" ON "admin_alerts"("type") WHERE "resolvedAt" IS NULL AND "storeId" IS NULL;
