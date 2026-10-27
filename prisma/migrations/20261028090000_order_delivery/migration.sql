-- AlterEnum
ALTER TYPE "MaterialOrderStatus" ADD VALUE 'DELIVERED';

-- AlterEnum
ALTER TYPE "NotificationType" ADD VALUE 'ORDER_DELIVERED';

-- AlterTable
ALTER TABLE "material_orders" ADD COLUMN     "deliveredAt" TIMESTAMP(3),
ADD COLUMN     "deliveredById" UUID;

-- AddForeignKey
ALTER TABLE "material_orders" ADD CONSTRAINT "material_orders_deliveredById_fkey" FOREIGN KEY ("deliveredById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

