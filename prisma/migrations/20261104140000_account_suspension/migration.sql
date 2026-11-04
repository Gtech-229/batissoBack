-- AlterEnum
ALTER TYPE "AccountStatus" ADD VALUE 'SUSPENDED';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "NotificationType" ADD VALUE 'ACCOUNT_SUSPENDED';
ALTER TYPE "NotificationType" ADD VALUE 'ACCOUNT_REACTIVATED';

-- AlterTable
ALTER TABLE "accounts" ADD COLUMN     "statusChangedAt" TIMESTAMP(3),
ADD COLUMN     "statusChangedById" UUID,
ADD COLUMN     "statusReason" VARCHAR(500);

-- AddForeignKey
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_statusChangedById_fkey" FOREIGN KEY ("statusChangedById") REFERENCES "admins"("id") ON DELETE SET NULL ON UPDATE CASCADE;

