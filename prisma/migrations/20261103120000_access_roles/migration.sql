-- AlterTable
ALTER TABLE "admins" ADD COLUMN     "roleId" UUID;

-- CreateTable
CREATE TABLE "admin_roles" (
    "id" UUID NOT NULL,
    "name" VARCHAR(60) NOT NULL,
    "permissions" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "admin_roles_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "admin_roles_name_key" ON "admin_roles"("name");

-- AddForeignKey
ALTER TABLE "admins" ADD CONSTRAINT "admins_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "admin_roles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Today's access for every existing ADMIN: nobody's access changes with this update.
INSERT INTO "admin_roles" ("id", "name", "permissions", "updatedAt") VALUES (
  gen_random_uuid(),
  'Administrateur',
  ARRAY['countries.read', 'countries.manage', 'stores.read', 'stores.manage', 'store-settings.manage', 'settings.read'],
  CURRENT_TIMESTAMP
);
UPDATE "admins" SET "roleId" = (SELECT "id" FROM "admin_roles" WHERE "name" = 'Administrateur')
WHERE "role" = 'ADMIN';
