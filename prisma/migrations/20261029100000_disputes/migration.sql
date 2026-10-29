-- CreateEnum
CREATE TYPE "DisputeStatus" AS ENUM ('OPEN', 'ANSWERED', 'CLOSED');

-- CreateEnum
CREATE TYPE "DisputeAuthor" AS ENUM ('CUSTOMER', 'STORE');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "NotificationType" ADD VALUE 'DISPUTE_OPENED';
ALTER TYPE "NotificationType" ADD VALUE 'DISPUTE_CUSTOMER_MESSAGE';
ALTER TYPE "NotificationType" ADD VALUE 'DISPUTE_STORE_REPLY';
ALTER TYPE "NotificationType" ADD VALUE 'DISPUTE_CLOSED';

-- CreateTable
CREATE TABLE "disputes" (
    "id" UUID NOT NULL,
    "operationId" UUID NOT NULL,
    "accountId" UUID NOT NULL,
    "storeId" UUID NOT NULL,
    "openedById" UUID NOT NULL,
    "status" "DisputeStatus" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "closedAt" TIMESTAMP(3),

    CONSTRAINT "disputes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dispute_messages" (
    "id" UUID NOT NULL,
    "disputeId" UUID NOT NULL,
    "author" "DisputeAuthor" NOT NULL,
    "authorId" UUID NOT NULL,
    "body" VARCHAR(1000) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "dispute_messages_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "disputes_storeId_createdAt_idx" ON "disputes"("storeId", "createdAt");

-- CreateIndex
CREATE INDEX "disputes_accountId_createdAt_idx" ON "disputes"("accountId", "createdAt");

-- CreateIndex
CREATE INDEX "dispute_messages_disputeId_createdAt_idx" ON "dispute_messages"("disputeId", "createdAt");

-- AddForeignKey
ALTER TABLE "disputes" ADD CONSTRAINT "disputes_operationId_fkey" FOREIGN KEY ("operationId") REFERENCES "operations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "disputes" ADD CONSTRAINT "disputes_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "disputes" ADD CONSTRAINT "disputes_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "hardware_stores"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "disputes" ADD CONSTRAINT "disputes_openedById_fkey" FOREIGN KEY ("openedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dispute_messages" ADD CONSTRAINT "dispute_messages_disputeId_fkey" FOREIGN KEY ("disputeId") REFERENCES "disputes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dispute_messages" ADD CONSTRAINT "dispute_messages_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- At most one dispute per operation is not CLOSED (12): a later disagreement
-- opens a new one once the previous is closed. "DisputeStatus" is created
-- (not altered) above, so its values can be used in this migration.
CREATE UNIQUE INDEX "disputes_one_open_per_operation"
  ON "disputes" ("operationId")
  WHERE "status" <> 'CLOSED';

-- A message is never blank.
ALTER TABLE "dispute_messages" ADD CONSTRAINT "dispute_messages_body_not_blank"
  CHECK (length(btrim("body")) > 0);

-- Append-only, like operations: a dispute's thread is proof and is never
-- changed or removed. TRUNCATE fires no row trigger (e2e reset).
CREATE FUNCTION "dispute_messages_reject_change"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Dispute messages are append-only: % refused on message %', TG_OP, OLD."id";
END;
$$;

CREATE TRIGGER "dispute_messages_append_only"
BEFORE UPDATE OR DELETE ON "dispute_messages"
FOR EACH ROW EXECUTE FUNCTION "dispute_messages_reject_change"();
