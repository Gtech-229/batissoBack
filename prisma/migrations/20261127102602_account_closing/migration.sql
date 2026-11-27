-- AlterEnum
ALTER TYPE "AccountStatus" ADD VALUE 'CLOSED';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "ActivityAction" ADD VALUE 'ACCOUNT_CLOSED';
ALTER TYPE "ActivityAction" ADD VALUE 'ACCOUNT_REOPENED';

-- AlterEnum
ALTER TYPE "NotificationType" ADD VALUE 'ACCOUNT_CLOSED_BY_STORE';

-- AlterTable
ALTER TABLE "accounts" ADD COLUMN     "closedAt" TIMESTAMP(3),
ADD COLUMN     "closedById" UUID,
ADD COLUMN     "closedReason" VARCHAR(500);

-- AddForeignKey
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_closedById_fkey" FOREIGN KEY ("closedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
