-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "ActivityAction" ADD VALUE 'ARTICLE_CATEGORY_CREATED';
ALTER TYPE "ActivityAction" ADD VALUE 'ARTICLE_CATEGORY_RENAMED';
ALTER TYPE "ActivityAction" ADD VALUE 'ARTICLE_CREATED';
ALTER TYPE "ActivityAction" ADD VALUE 'ARTICLE_UPDATED';
ALTER TYPE "ActivityAction" ADD VALUE 'ARTICLE_PRICE_CHANGED';

-- AlterTable
ALTER TABLE "goals" ADD COLUMN     "articleId" UUID;

-- CreateTable
CREATE TABLE "article_categories" (
    "id" UUID NOT NULL,
    "storeId" UUID NOT NULL,
    "name" VARCHAR(60) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "article_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "articles" (
    "id" UUID NOT NULL,
    "storeId" UUID NOT NULL,
    "categoryId" UUID NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "unit" VARCHAR(50) NOT NULL,
    "currentPrice" BIGINT NOT NULL,
    "available" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "articles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "price_history" (
    "id" UUID NOT NULL,
    "articleId" UUID NOT NULL,
    "price" BIGINT NOT NULL,
    "startsAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "price_history_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "article_categories_storeId_idx" ON "article_categories"("storeId");

-- CreateIndex
CREATE INDEX "articles_storeId_categoryId_idx" ON "articles"("storeId", "categoryId");

-- CreateIndex
CREATE INDEX "price_history_articleId_startsAt_idx" ON "price_history"("articleId", "startsAt");

-- AddForeignKey
ALTER TABLE "goals" ADD CONSTRAINT "goals_articleId_fkey" FOREIGN KEY ("articleId") REFERENCES "articles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "article_categories" ADD CONSTRAINT "article_categories_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "hardware_stores"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "articles" ADD CONSTRAINT "articles_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "hardware_stores"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "articles" ADD CONSTRAINT "articles_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "article_categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "price_history" ADD CONSTRAINT "price_history_articleId_fkey" FOREIGN KEY ("articleId") REFERENCES "articles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;



-- Names are unique per store ignoring case: "Ciment" and "CIMENT" are the same
-- category (Prisma cannot declare an index on an expression).
CREATE UNIQUE INDEX "article_categories_storeId_name_key" ON "article_categories" ("storeId", lower("name"));
CREATE UNIQUE INDEX "articles_storeId_name_key" ON "articles" ("storeId", lower("name"));

-- A price is always positive; the checks back the API's own validation.
ALTER TABLE "articles" ADD CONSTRAINT "articles_current_price_positive" CHECK ("currentPrice" > 0);
ALTER TABLE "price_history" ADD CONSTRAINT "price_history_price_positive" CHECK ("price" > 0);

-- The stores registered before the catalogue get the default categories that
-- new stores are created with (src/catalogue/default-categories.ts).
INSERT INTO "article_categories" ("id", "storeId", "name")
SELECT gen_random_uuid(), s."id", c."name"
FROM "hardware_stores" s
CROSS JOIN (VALUES
  ('Ciment'), ('Fer et acier'), ('Tôles et toiture'), ('Bois'),
  ('Sable et gravier'), ('Briques et parpaings'), ('Plomberie'),
  ('Électricité'), ('Peinture'), ('Carrelage'), ('Quincaillerie')
) AS c("name");
