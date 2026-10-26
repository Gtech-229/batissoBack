-- CreateEnum
CREATE TYPE "MaterialOrderStatus" AS ENUM ('AWAITING_VALIDATION', 'AWAITING_CUSTOMER', 'REFUSED_BY_MANAGER', 'CANCELLED');

-- CreateTable
CREATE TABLE "material_orders" (
    "id" UUID NOT NULL,
    "reference" VARCHAR(20) NOT NULL,
    "storeId" UUID NOT NULL,
    "accountId" UUID NOT NULL,
    "goalId" UUID NOT NULL,
    "status" "MaterialOrderStatus" NOT NULL,
    "total" BIGINT NOT NULL,
    "createdById" UUID NOT NULL,
    "validatedById" UUID,
    "validatedAt" TIMESTAMP(3),
    "refusedById" UUID,
    "refusedAt" TIMESTAMP(3),
    "refusalReason" VARCHAR(500),
    "cancelledById" UUID,
    "cancelledAt" TIMESTAMP(3),
    "cancellationReason" VARCHAR(500),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "material_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "material_order_lines" (
    "id" UUID NOT NULL,
    "orderId" UUID NOT NULL,
    "articleId" UUID NOT NULL,
    "articleName" VARCHAR(100) NOT NULL,
    "unit" VARCHAR(50) NOT NULL,
    "quantity" INTEGER NOT NULL,
    "unitPrice" BIGINT NOT NULL,

    CONSTRAINT "material_order_lines_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "material_orders_reference_key" ON "material_orders"("reference");

-- CreateIndex
CREATE INDEX "material_orders_storeId_createdAt_idx" ON "material_orders"("storeId", "createdAt");

-- CreateIndex
CREATE INDEX "material_orders_accountId_createdAt_idx" ON "material_orders"("accountId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "material_order_lines_orderId_articleId_key" ON "material_order_lines"("orderId", "articleId");

-- AddForeignKey
ALTER TABLE "material_orders" ADD CONSTRAINT "material_orders_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "hardware_stores"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "material_orders" ADD CONSTRAINT "material_orders_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "material_orders" ADD CONSTRAINT "material_orders_goalId_fkey" FOREIGN KEY ("goalId") REFERENCES "goals"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "material_orders" ADD CONSTRAINT "material_orders_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "material_orders" ADD CONSTRAINT "material_orders_validatedById_fkey" FOREIGN KEY ("validatedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "material_orders" ADD CONSTRAINT "material_orders_refusedById_fkey" FOREIGN KEY ("refusedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "material_orders" ADD CONSTRAINT "material_orders_cancelledById_fkey" FOREIGN KEY ("cancelledById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "material_order_lines" ADD CONSTRAINT "material_order_lines_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "material_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "material_order_lines" ADD CONSTRAINT "material_order_lines_articleId_fkey" FOREIGN KEY ("articleId") REFERENCES "articles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;



-- Amounts and quantities are always positive; the checks back the API's own
-- validation, so even a bug cannot record an empty or negative order.
ALTER TABLE "material_orders" ADD CONSTRAINT "material_orders_total_positive" CHECK ("total" > 0);
ALTER TABLE "material_order_lines" ADD CONSTRAINT "material_order_lines_quantity_positive" CHECK ("quantity" > 0);
ALTER TABLE "material_order_lines" ADD CONSTRAINT "material_order_lines_unit_price_positive" CHECK ("unitPrice" > 0);

-- Order references (B-00001): one platform-wide sequence, like deposits.
-- Gaps (a refused preparation) are harmless.
CREATE SEQUENCE "material_order_reference_seq" AS BIGINT START WITH 1;
