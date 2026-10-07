-- CreateEnum
CREATE TYPE "StoreStatus" AS ENUM ('PENDING', 'VERIFIED', 'SUSPENDED', 'CLOSED');

-- CreateEnum
CREATE TYPE "StoreMemberRole" AS ENUM ('SELLER', 'MANAGER');

-- CreateTable
CREATE TABLE "countries" (
    "code" VARCHAR(2) NOT NULL,
    "name" TEXT NOT NULL,
    "phonePrefix" TEXT NOT NULL,
    "currencyCode" VARCHAR(3) NOT NULL,
    "currencySymbol" TEXT NOT NULL,
    "decimals" INTEGER NOT NULL,
    "language" VARCHAR(2) NOT NULL DEFAULT 'fr',
    "active" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "countries_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "hardware_stores" (
    "id" UUID NOT NULL,
    "countryCode" VARCHAR(2) NOT NULL,
    "name" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "city" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "tradeRegister" TEXT NOT NULL,
    "status" "StoreStatus" NOT NULL DEFAULT 'PENDING',
    "verifiedAt" TIMESTAMP(3),
    "statusChangedAt" TIMESTAMP(3),
    "statusChangedById" UUID,
    "statusReason" TEXT,
    "createdById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "hardware_stores_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "store_settings" (
    "storeId" UUID NOT NULL,
    "maxBalance" BIGINT NOT NULL,
    "validationThreshold" BIGINT NOT NULL,
    "minDeposit" BIGINT NOT NULL,
    "refundAllowed" BOOLEAN NOT NULL DEFAULT false,
    "reservationEnabled" BOOLEAN NOT NULL DEFAULT false,
    "terms" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedById" UUID,

    CONSTRAINT "store_settings_pkey" PRIMARY KEY ("storeId")
);

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "phone" TEXT NOT NULL,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "store_members" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "storeId" UUID NOT NULL,
    "role" "StoreMemberRole" NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "store_members_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "hardware_stores_status_createdAt_idx" ON "hardware_stores"("status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "users_phone_key" ON "users"("phone");

-- CreateIndex
CREATE UNIQUE INDEX "store_members_userId_storeId_key" ON "store_members"("userId", "storeId");

-- AddForeignKey
ALTER TABLE "hardware_stores" ADD CONSTRAINT "hardware_stores_countryCode_fkey" FOREIGN KEY ("countryCode") REFERENCES "countries"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hardware_stores" ADD CONSTRAINT "hardware_stores_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "admins"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hardware_stores" ADD CONSTRAINT "hardware_stores_statusChangedById_fkey" FOREIGN KEY ("statusChangedById") REFERENCES "admins"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "store_settings" ADD CONSTRAINT "store_settings_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "hardware_stores"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "store_settings" ADD CONSTRAINT "store_settings_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "admins"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "store_members" ADD CONSTRAINT "store_members_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "store_members" ADD CONSTRAINT "store_members_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "hardware_stores"("id") ON DELETE CASCADE ON UPDATE CASCADE;
