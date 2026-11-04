-- CreateEnum
CREATE TYPE "PasswordTokenMode" AS ENUM ('SET', 'RESET');

-- AlterTable
ALTER TABLE "admins" ALTER COLUMN "passwordHash" DROP NOT NULL;

-- Admins still waiting on the old forced change hold the initial password the
-- super admin chose: wipe it and end their sessions; they set their own with
-- forgot-password?mode=set (feature 22).
UPDATE "admin_sessions" SET "revokedAt" = CURRENT_TIMESTAMP
WHERE "revokedAt" IS NULL
  AND "adminId" IN (SELECT "id" FROM "admins" WHERE "mustChangePassword");
UPDATE "admins" SET "passwordHash" = NULL WHERE "mustChangePassword";

ALTER TABLE "admins" DROP COLUMN "mustChangePassword";

-- CreateTable
CREATE TABLE "admin_password_tokens" (
    "id" UUID NOT NULL,
    "adminId" UUID NOT NULL,
    "mode" "PasswordTokenMode" NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "admin_password_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "admin_password_tokens_tokenHash_key" ON "admin_password_tokens"("tokenHash");

-- CreateIndex
CREATE INDEX "admin_password_tokens_adminId_createdAt_idx" ON "admin_password_tokens"("adminId", "createdAt");

-- AddForeignKey
ALTER TABLE "admin_password_tokens" ADD CONSTRAINT "admin_password_tokens_adminId_fkey" FOREIGN KEY ("adminId") REFERENCES "admins"("id") ON DELETE CASCADE ON UPDATE CASCADE;

