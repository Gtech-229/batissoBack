-- CreateEnum
CREATE TYPE "GoalMovementReason" AS ENUM ('MOVE', 'GOAL_CLOSED');

-- AlterEnum
ALTER TYPE "NotificationType" ADD VALUE 'GOAL_REACHED';

-- AlterTable
ALTER TABLE "goals" ADD COLUMN     "projectId" UUID,
ADD COLUMN     "reachedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "projects" (
    "id" UUID NOT NULL,
    "accountId" UUID NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "projects_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "goal_movements" (
    "id" UUID NOT NULL,
    "accountId" UUID NOT NULL,
    "sourceGoalId" UUID NOT NULL,
    "targetGoalId" UUID NOT NULL,
    "amount" BIGINT NOT NULL,
    "reason" "GoalMovementReason" NOT NULL,
    "authorId" UUID NOT NULL,
    "idempotencyKey" UUID,
    "device" VARCHAR(100),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "goal_movements_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "projects_accountId_idx" ON "projects"("accountId");

-- CreateIndex
CREATE UNIQUE INDEX "goal_movements_idempotencyKey_key" ON "goal_movements"("idempotencyKey");

-- CreateIndex
CREATE INDEX "goal_movements_accountId_createdAt_idx" ON "goal_movements"("accountId", "createdAt");

-- AddForeignKey
ALTER TABLE "goals" ADD CONSTRAINT "goals_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "projects" ADD CONSTRAINT "projects_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goal_movements" ADD CONSTRAINT "goal_movements_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goal_movements" ADD CONSTRAINT "goal_movements_sourceGoalId_fkey" FOREIGN KEY ("sourceGoalId") REFERENCES "goals"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goal_movements" ADD CONSTRAINT "goal_movements_targetGoalId_fkey" FOREIGN KEY ("targetGoalId") REFERENCES "goals"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goal_movements" ADD CONSTRAINT "goal_movements_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- A balance never goes below zero: a goal or an account cannot spend money it
-- does not hold. The checks back the API's own checks (made under the account
-- lock), so even a bug cannot record a negative balance.
ALTER TABLE "goals" ADD CONSTRAINT "goals_balance_not_negative" CHECK ("balance" >= 0);
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_balance_not_negative" CHECK ("balance" >= 0);

-- A movement moves a positive amount between two different goals.
ALTER TABLE "goal_movements" ADD CONSTRAINT "goal_movements_amount_positive" CHECK ("amount" > 0);
ALTER TABLE "goal_movements" ADD CONSTRAINT "goal_movements_distinct_goals" CHECK ("sourceGoalId" <> "targetGoalId");

-- Append-only, like operations: the record of how money was split between goals
-- is never changed or removed. TRUNCATE fires no row trigger (e2e reset).
CREATE FUNCTION "goal_movements_reject_change"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Goal movements are append-only: % refused on movement %', TG_OP, OLD."id";
END;
$$;

CREATE TRIGGER "goal_movements_append_only"
BEFORE UPDATE OR DELETE ON "goal_movements"
FOR EACH ROW EXECUTE FUNCTION "goal_movements_reject_change"();
