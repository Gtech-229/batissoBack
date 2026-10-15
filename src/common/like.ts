/**
 * Prisma's `contains` becomes `ILIKE '%value%'` without escaping, so `%` and `_`
 * in a search would act as wildcards. Backslash is PostgreSQL's default LIKE
 * escape: escape it first, then the two wildcards, so the text is matched as is.
 */
export function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (char) => `\\${char}`);
}
