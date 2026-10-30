-- CreateTable
CREATE TABLE "cash_closings" (
    "id" UUID NOT NULL,
    "storeId" UUID NOT NULL,
    "managerId" UUID NOT NULL,
    "currencyCode" VARCHAR(3) NOT NULL,
    "depositsTotal" BIGINT NOT NULL,
    "correctionsTotal" BIGINT NOT NULL,
    "expectedTotal" BIGINT NOT NULL,
    "countedTotal" BIGINT NOT NULL,
    "discrepancy" BIGINT NOT NULL,
    "justification" VARCHAR(500),
    "idempotencyKey" UUID NOT NULL,
    "device" VARCHAR(100),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cash_closings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cash_closing_operations" (
    "operationId" UUID NOT NULL,
    "closingId" UUID NOT NULL,

    CONSTRAINT "cash_closing_operations_pkey" PRIMARY KEY ("operationId")
);

-- CreateIndex
CREATE UNIQUE INDEX "cash_closings_idempotencyKey_key" ON "cash_closings"("idempotencyKey");

-- CreateIndex
CREATE INDEX "cash_closings_storeId_createdAt_idx" ON "cash_closings"("storeId", "createdAt");

-- CreateIndex
CREATE INDEX "cash_closing_operations_closingId_idx" ON "cash_closing_operations"("closingId");

-- AddForeignKey
ALTER TABLE "cash_closings" ADD CONSTRAINT "cash_closings_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "hardware_stores"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cash_closings" ADD CONSTRAINT "cash_closings_managerId_fkey" FOREIGN KEY ("managerId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cash_closing_operations" ADD CONSTRAINT "cash_closing_operations_operationId_fkey" FOREIGN KEY ("operationId") REFERENCES "operations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cash_closing_operations" ADD CONSTRAINT "cash_closing_operations_closingId_fkey" FOREIGN KEY ("closingId") REFERENCES "cash_closings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- The arithmetic of a closing, whatever the client of the database (13).
ALTER TABLE "cash_closings"
  ADD CONSTRAINT "cash_closings_expected_check"
    CHECK ("expectedTotal" = "depositsTotal" - "correctionsTotal"),
  ADD CONSTRAINT "cash_closings_discrepancy_check"
    CHECK ("discrepancy" = "countedTotal" - "expectedTotal"),
  ADD CONSTRAINT "cash_closings_amounts_not_negative"
    CHECK ("countedTotal" >= 0 AND "depositsTotal" >= 0 AND "correctionsTotal" >= 0),
  ADD CONSTRAINT "cash_closings_justified"
    CHECK ("discrepancy" = 0 OR "justification" IS NOT NULL);

-- Final, like operations: a closing and what it counted are proof, never
-- changed or removed. TRUNCATE fires no row trigger (e2e reset).
CREATE FUNCTION "cash_closings_reject_change"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Cash closings are append-only: % refused on %', TG_OP, TG_TABLE_NAME;
END;
$$;

CREATE TRIGGER "cash_closings_append_only"
BEFORE UPDATE OR DELETE ON "cash_closings"
FOR EACH ROW EXECUTE FUNCTION "cash_closings_reject_change"();

CREATE TRIGGER "cash_closing_operations_append_only"
BEFORE UPDATE OR DELETE ON "cash_closing_operations"
FOR EACH ROW EXECUTE FUNCTION "cash_closings_reject_change"();
