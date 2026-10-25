-- AlterEnum
ALTER TYPE "ActivityAction" ADD VALUE 'STORE_QR_CODE_REGENERATED';

-- AlterTable
ALTER TABLE "hardware_stores" ADD COLUMN     "qrCode" VARCHAR(32);

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "qrCode" VARCHAR(32);

-- CreateIndex
CREATE UNIQUE INDEX "hardware_stores_qrCode_key" ON "hardware_stores"("qrCode");

-- CreateIndex
CREATE UNIQUE INDEX "users_qrCode_key" ON "users"("qrCode");

