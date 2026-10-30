-- AlterEnum
ALTER TYPE "ActivityAction" ADD VALUE 'SECURITY_QUESTIONS_CLEARED';

-- AlterEnum
ALTER TYPE "NotificationType" ADD VALUE 'ACCESS_RECOVERED';

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "failedRecoveryAttempts" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "recoveryLockedUntil" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "security_questions" (
    "id" UUID NOT NULL,
    "text" VARCHAR(200) NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "security_questions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_security_answers" (
    "userId" UUID NOT NULL,
    "questionId" UUID NOT NULL,
    "answerHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_security_answers_pkey" PRIMARY KEY ("userId","questionId")
);

-- CreateIndex
CREATE UNIQUE INDEX "security_questions_text_key" ON "security_questions"("text");

-- AddForeignKey
ALTER TABLE "user_security_answers" ADD CONSTRAINT "user_security_answers_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_security_answers" ADD CONSTRAINT "user_security_answers_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "security_questions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- The questions users start with: a user needs three to choose from.
INSERT INTO "security_questions" ("id", "text") VALUES
  (gen_random_uuid(), 'Quel est le nom de votre école primaire ?'),
  (gen_random_uuid(), 'Quel était votre surnom d’enfance ?'),
  (gen_random_uuid(), 'Dans quel quartier ou village avez-vous grandi ?');
