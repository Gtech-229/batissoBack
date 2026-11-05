-- CreateEnum
CREATE TYPE "AdminAlertType" AS ENUM ('ACCOUNT_BALANCE_GAP', 'GOAL_BALANCE_GAP', 'GOAL_SUM_GAP');

-- CreateTable
CREATE TABLE "admin_alerts" (
    "id" UUID NOT NULL,
    "type" "AdminAlertType" NOT NULL,
    "storeId" UUID NOT NULL,
    "accountId" UUID NOT NULL,
    "goalId" UUID,
    "difference" BIGINT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),
    "resolvedById" UUID,

    CONSTRAINT "admin_alerts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "admin_alerts_resolvedAt_createdAt_idx" ON "admin_alerts"("resolvedAt", "createdAt");

-- AddForeignKey
ALTER TABLE "admin_alerts" ADD CONSTRAINT "admin_alerts_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "hardware_stores"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "admin_alerts" ADD CONSTRAINT "admin_alerts_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "admin_alerts" ADD CONSTRAINT "admin_alerts_goalId_fkey" FOREIGN KEY ("goalId") REFERENCES "goals"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "admin_alerts" ADD CONSTRAINT "admin_alerts_resolvedById_fkey" FOREIGN KEY ("resolvedById") REFERENCES "admins"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- One unresolved alert per type, account and goal: a nightly run adds nothing
-- while the same gap is still open (ON CONFLICT DO NOTHING). Prisma cannot
-- declare a partial or expression index, so it lives only here.
CREATE UNIQUE INDEX "admin_alerts_one_open_per_target" ON "admin_alerts"("type", "accountId", COALESCE("goalId", '00000000-0000-0000-0000-000000000000'::uuid)) WHERE "resolvedAt" IS NULL;
