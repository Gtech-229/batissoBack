-- CreateEnum
CREATE TYPE "ActivityAction" AS ENUM ('SELLER_ADDED', 'SELLER_DEACTIVATED', 'SELLER_REACTIVATED');

-- CreateTable
CREATE TABLE "activity_logs" (
    "id" UUID NOT NULL,
    "storeId" UUID,
    "userId" UUID NOT NULL,
    "action" "ActivityAction" NOT NULL,
    "oldValue" JSONB,
    "newValue" JSONB,
    "device" VARCHAR(100),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "activity_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "activity_logs_storeId_createdAt_idx" ON "activity_logs"("storeId", "createdAt");

-- AddForeignKey
ALTER TABLE "activity_logs" ADD CONSTRAINT "activity_logs_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "hardware_stores"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "activity_logs" ADD CONSTRAINT "activity_logs_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
