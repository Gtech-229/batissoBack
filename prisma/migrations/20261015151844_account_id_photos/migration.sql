-- AlterEnum
ALTER TYPE "ActivityAction" ADD VALUE 'ID_PHOTO_UPLOADED';

-- AlterTable
ALTER TABLE "accounts" ADD COLUMN     "idPhotoPath" VARCHAR(100);
