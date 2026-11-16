-- Strict alert target (F-92): a code-limit alert has neither store nor
-- account; every other alert has both. The CHECK of the previous migration
-- only tied the code-limit type to "both empty", so another type could keep
-- one without the other. The type is compared as text, as before.
ALTER TABLE "admin_alerts" DROP CONSTRAINT "admin_alerts_target_check";
ALTER TABLE "admin_alerts" ADD CONSTRAINT "admin_alerts_target_check" CHECK (
  ("type"::text = 'CODE_LIMIT_REACHED' AND "storeId" IS NULL AND "accountId" IS NULL)
  OR ("type"::text <> 'CODE_LIMIT_REACHED' AND "storeId" IS NOT NULL AND "accountId" IS NOT NULL)
);
