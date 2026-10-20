-- The append-only trigger raised `restrict_violation`, an integrity code that
-- Prisma reports as "Foreign key constraint violated". The default code
-- (P0001, raise_exception) keeps the real message: "Operations are
-- append-only: ... refused on operation D-...".
CREATE OR REPLACE FUNCTION "operations_reject_change"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Operations are append-only: % refused on operation %', TG_OP, OLD."reference";
END;
$$;
