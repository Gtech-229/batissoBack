import { GoalStatus } from '../generated/prisma/client.js';

/** What decides a goal's status. */
export interface GoalStateInput {
  status: GoalStatus;
  targetAmount: bigint | null;
  reachedAt: Date | null;
}

export interface GoalState {
  status: GoalStatus;
  reachedAt: Date | null;
  /** True only when this change made the goal reach its target. */
  justReached: boolean;
}

/**
 * A goal's status for a new balance (or a new target): `REACHED` when it has a
 * target and the balance is at or above it, `IN_PROGRESS` otherwise. A closed
 * goal stays closed. `justReached` tells the caller to notify the customer: it
 * is true only on the change that crosses the target, so a goal already
 * reached never notifies twice, and one that fell back below and crosses again
 * notifies again.
 */
export function nextGoalState(
  goal: GoalStateInput,
  balance: bigint,
  now: Date = new Date(),
): GoalState {
  if (goal.status === GoalStatus.CLOSED) {
    return {
      status: goal.status,
      reachedAt: goal.reachedAt,
      justReached: false,
    };
  }
  const reached = goal.targetAmount !== null && balance >= goal.targetAmount;
  if (!reached) {
    return {
      status: GoalStatus.IN_PROGRESS,
      reachedAt: null,
      justReached: false,
    };
  }
  if (goal.status === GoalStatus.REACHED) {
    return {
      status: goal.status,
      reachedAt: goal.reachedAt,
      justReached: false,
    };
  }
  return { status: GoalStatus.REACHED, reachedAt: now, justReached: true };
}
