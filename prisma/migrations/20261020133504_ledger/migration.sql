-- CreateEnum
CREATE TYPE "OperationType" AS ENUM ('DEPOSIT', 'MATERIAL_DEBIT', 'CORRECTION', 'REFUND');

-- CreateEnum
CREATE TYPE "OperationDirection" AS ENUM ('CREDIT', 'DEBIT');

-- CreateEnum
CREATE TYPE "OperationStatus" AS ENUM ('PENDING', 'CONFIRMED', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "OperationChannel" AS ENUM ('CASH', 'MOBILE_MONEY');

-- AlterTable
ALTER TABLE "goals" ADD COLUMN     "balance" BIGINT NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "operations" (
    "id" UUID NOT NULL,
    "reference" VARCHAR(20) NOT NULL,
    "accountId" UUID NOT NULL,
    "storeId" UUID NOT NULL,
    "goalId" UUID NOT NULL,
    "type" "OperationType" NOT NULL,
    "amount" BIGINT NOT NULL,
    "direction" "OperationDirection" NOT NULL,
    "currencyCode" VARCHAR(3) NOT NULL,
    "balanceBefore" BIGINT NOT NULL,
    "balanceAfter" BIGINT NOT NULL,
    "status" "OperationStatus" NOT NULL,
    "authorId" UUID NOT NULL,
    "validatedById" UUID,
    "customerConfirmedAt" TIMESTAMP(3),
    "correctedOperationId" UUID,
    "reason" VARCHAR(500),
    "channel" "OperationChannel" NOT NULL,
    "externalReference" VARCHAR(100),
    "idempotencyKey" UUID NOT NULL,
    "device" VARCHAR(100),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "operations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "operations_reference_key" ON "operations"("reference");

-- CreateIndex
CREATE UNIQUE INDEX "operations_idempotencyKey_key" ON "operations"("idempotencyKey");

-- CreateIndex
CREATE INDEX "operations_accountId_createdAt_idx" ON "operations"("accountId", "createdAt");

-- CreateIndex
CREATE INDEX "operations_storeId_createdAt_idx" ON "operations"("storeId", "createdAt");

-- AddForeignKey
ALTER TABLE "operations" ADD CONSTRAINT "operations_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "operations" ADD CONSTRAINT "operations_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "hardware_stores"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "operations" ADD CONSTRAINT "operations_goalId_fkey" FOREIGN KEY ("goalId") REFERENCES "goals"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "operations" ADD CONSTRAINT "operations_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "operations" ADD CONSTRAINT "operations_validatedById_fkey" FOREIGN KEY ("validatedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "operations" ADD CONSTRAINT "operations_correctedOperationId_fkey" FOREIGN KEY ("correctedOperationId") REFERENCES "operations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Deposit references: "D-" + the next value, padded to 5 digits (D-00482). One
-- sequence for the whole platform; each later operation type gets its own. A
-- sequence never rolls back: a refused deposit leaves a harmless gap.
CREATE SEQUENCE "operation_reference_deposit_seq" AS BIGINT START WITH 1;

-- An amount is always positive; `direction` says which way it moves.
ALTER TABLE "operations" ADD CONSTRAINT "operations_amount_positive" CHECK ("amount" > 0);

-- Append-only ledger: the database itself refuses to change or remove an
-- operation, whoever asks (the API, a script, a person in a SQL console). A
-- mistake is fixed by a new CORRECTION linked to the original (feature 11).
-- TRUNCATE fires no row trigger, so the e2e reset still empties the table.
CREATE FUNCTION "operations_reject_change"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Operations are append-only: % refused on operation %', TG_OP, OLD."reference"
    USING ERRCODE = 'restrict_violation';
END;
$$;

CREATE TRIGGER "operations_append_only"
BEFORE UPDATE OR DELETE ON "operations"
FOR EACH ROW EXECUTE FUNCTION "operations_reject_change"();
