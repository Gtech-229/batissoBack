/**
 * Keeps only the keys whose value is not `undefined`.
 *
 * A DTO instance has every declared field, set to `undefined` when the client
 * omitted it (ES2022+ class fields). Spreading it into Prisma data as-is would
 * overwrite stored values or defaults, so partial updates go through this first.
 */
export function definedOnly<T extends object>(values: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(values).filter(([, value]) => value !== undefined),
  ) as Partial<T>;
}
