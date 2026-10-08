-- AlterTable
ALTER TABLE "user_devices" ADD COLUMN     "publicKey" TEXT;

-- CreateTable
CREATE TABLE "device_challenges" (
    "id" UUID NOT NULL,
    "phone" VARCHAR(30) NOT NULL,
    "deviceId" VARCHAR(100) NOT NULL,
    "challenge" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "device_challenges_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "device_challenges_challenge_key" ON "device_challenges"("challenge");
