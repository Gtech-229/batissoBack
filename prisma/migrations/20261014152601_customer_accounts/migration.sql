-- CreateEnum
CREATE TYPE "AccountStatus" AS ENUM ('ACTIVE');

-- CreateEnum
CREATE TYPE "GoalStatus" AS ENUM ('IN_PROGRESS', 'REACHED', 'CLOSED');

-- AlterEnum
ALTER TYPE "ActivityAction" ADD VALUE 'ACCOUNT_OPENED';

-- CreateTable
CREATE TABLE "accounts" (
    "id" UUID NOT NULL,
    "number" VARCHAR(20) NOT NULL,
    "customerId" UUID NOT NULL,
    "storeId" UUID NOT NULL,
    "currencyCode" VARCHAR(3) NOT NULL,
    "balance" BIGINT NOT NULL DEFAULT 0,
    "beneficiaryName" VARCHAR(100),
    "beneficiaryPhone" TEXT,
    "status" "AccountStatus" NOT NULL DEFAULT 'ACTIVE',
    "termsAcceptedAt" TIMESTAMP(3) NOT NULL,
    "openedById" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "goals" (
    "id" UUID NOT NULL,
    "accountId" UUID NOT NULL,
    "label" VARCHAR(100) NOT NULL,
    "targetAmount" BIGINT,
    "status" "GoalStatus" NOT NULL DEFAULT 'IN_PROGRESS',
    "isSystem" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "goals_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "accounts_number_key" ON "accounts"("number");

-- CreateIndex
CREATE INDEX "accounts_storeId_createdAt_idx" ON "accounts"("storeId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "accounts_customerId_storeId_key" ON "accounts"("customerId", "storeId");

-- CreateIndex
CREATE INDEX "goals_accountId_idx" ON "goals"("accountId");

-- AddForeignKey
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "hardware_stores"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_openedById_fkey" FOREIGN KEY ("openedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goals" ADD CONSTRAINT "goals_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Account numbers: "C-" + the next value, padded to 6 digits (C-000123). One
-- sequence for the whole platform, so a number is unique across stores. A
-- sequence never rolls back: a failed opening leaves a gap, which is harmless.
CREATE SEQUENCE "account_number_seq" AS BIGINT START WITH 1;

-- One system goal (the Unassigned goal, "Non affecté") per account. A partial
-- unique index: Prisma's schema cannot declare one, so it lives here only.
CREATE UNIQUE INDEX "goals_one_system_goal_per_account" ON "goals"("accountId") WHERE "isSystem";
