-- AlterEnum
ALTER TYPE "AdminAlertType" ADD VALUE 'WHATSAPP_SETTINGS_CHANGED';

-- AlterTable
ALTER TABLE "admin_alerts" ADD COLUMN     "whatsappSettingsChangeId" UUID;

-- CreateTable
CREATE TABLE "whatsapp_settings" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "instanceId" TEXT,
    "tokenCiphertext" TEXT,
    "tokenLast4" VARCHAR(4),
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedById" UUID,

    CONSTRAINT "whatsapp_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "whatsapp_settings_changes" (
    "id" UUID NOT NULL,
    "adminId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "enabledBefore" BOOLEAN NOT NULL,
    "enabledAfter" BOOLEAN NOT NULL,
    "instanceIdBefore" TEXT,
    "instanceIdAfter" TEXT,
    "tokenChanged" BOOLEAN NOT NULL,
    "tokenLast4" VARCHAR(4),

    CONSTRAINT "whatsapp_settings_changes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "whatsapp_settings_changes_createdAt_idx" ON "whatsapp_settings_changes"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "admin_alerts_whatsappSettingsChangeId_key" ON "admin_alerts"("whatsappSettingsChangeId");

-- AddForeignKey
ALTER TABLE "admin_alerts" ADD CONSTRAINT "admin_alerts_whatsappSettingsChangeId_fkey" FOREIGN KEY ("whatsappSettingsChangeId") REFERENCES "whatsapp_settings_changes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "whatsapp_settings" ADD CONSTRAINT "whatsapp_settings_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "admins"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "whatsapp_settings_changes" ADD CONSTRAINT "whatsapp_settings_changes_adminId_fkey" FOREIGN KEY ("adminId") REFERENCES "admins"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Each alert has exactly its own target (25b extends 25a's CHECK): a code-limit
-- alert has no store, no account and no change; a WhatsApp settings alert has
-- no store and no account but its change; any other alert has its store and
-- account and no change. The type is compared as text: PostgreSQL refuses to
-- use an enum value added in the same transaction.
ALTER TABLE "admin_alerts" DROP CONSTRAINT "admin_alerts_target_check";
ALTER TABLE "admin_alerts" ADD CONSTRAINT "admin_alerts_target_check" CHECK (
  ("type"::text = 'CODE_LIMIT_REACHED'
    AND "storeId" IS NULL AND "accountId" IS NULL AND "whatsappSettingsChangeId" IS NULL)
  OR ("type"::text = 'WHATSAPP_SETTINGS_CHANGED'
    AND "storeId" IS NULL AND "accountId" IS NULL AND "whatsappSettingsChangeId" IS NOT NULL)
  OR ("type"::text NOT IN ('CODE_LIMIT_REACHED', 'WHATSAPP_SETTINGS_CHANGED')
    AND "storeId" IS NOT NULL AND "accountId" IS NOT NULL AND "whatsappSettingsChangeId" IS NULL)
);

-- One open code-limit alert at a time, as before, but never merging WhatsApp
-- alerts (one per change): only rows without a store and without a change are
-- code-limit alerts, by the CHECK above. An index condition cannot cast the enum.
DROP INDEX "admin_alerts_one_open_code_limit";
CREATE UNIQUE INDEX "admin_alerts_one_open_code_limit" ON "admin_alerts"("type") WHERE "resolvedAt" IS NULL AND "storeId" IS NULL AND "whatsappSettingsChangeId" IS NULL;
