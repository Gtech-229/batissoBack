-- AlterEnum
ALTER TYPE "NotificationType" ADD VALUE 'INACTIVITY_REMINDER';

-- AlterTable
ALTER TABLE "accounts" ADD COLUMN     "inactivityRemindedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "system_settings" ADD COLUMN     "inactivityReminderDays" INTEGER NOT NULL DEFAULT 30;


-- The reminder delay's range, also enforced by the settings DTO.
ALTER TABLE "system_settings" ADD CONSTRAINT "system_settings_inactivity_reminder_days_check" CHECK ("inactivityReminderDays" BETWEEN 1 AND 365);
