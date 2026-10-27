-- AlterEnum
ALTER TYPE "GoalMovementReason" ADD VALUE 'CORRECTION_SHORTFALL';

-- AlterEnum
ALTER TYPE "NotificationType" ADD VALUE 'CORRECTION_RECORDED';


-- One platform-wide sequence for correction references (R-00001).
CREATE SEQUENCE "operation_reference_correction_seq";

-- Only a correction is linked to the operation it fixes, and a correction
-- always is, with a reason.
ALTER TABLE "operations" ADD CONSTRAINT "operations_correction_link_check"
  CHECK (
    ("type" = 'CORRECTION') = ("correctedOperationId" IS NOT NULL)
    AND ("type" <> 'CORRECTION' OR "reason" IS NOT NULL)
  );
