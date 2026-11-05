-- AlterTable
ALTER TABLE "hardware_stores" ADD COLUMN     "managerIdPhotoPath" TEXT,
ADD COLUMN     "registeredById" UUID,
ADD COLUMN     "requestedPlan" "SubscriptionPlan",
ADD COLUMN     "tradeRegisterPhotoPath" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "hardware_stores_registeredById_key" ON "hardware_stores"("registeredById");

-- AddForeignKey
ALTER TABLE "hardware_stores" ADD CONSTRAINT "hardware_stores_registeredById_fkey" FOREIGN KEY ("registeredById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

