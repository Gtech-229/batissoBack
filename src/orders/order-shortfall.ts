/**
 * What Unassigned must move into an order's goal before the debit (10b): the
 * part of the total the goal does not hold, never negative. Zero when the goal
 * holds enough, or when the goal is Unassigned itself (nothing to move).
 */
export function orderShortfall(
  total: bigint,
  goalBalance: bigint,
  goalIsUnassigned: boolean,
): bigint {
  if (goalIsUnassigned || goalBalance >= total) {
    return 0n;
  }
  return total - goalBalance;
}
