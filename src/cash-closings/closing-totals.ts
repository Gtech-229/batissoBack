import { OperationType } from '../generated/prisma/client.js';

/** What a closing needs to know of an operation it counts. */
export interface CountedOperation {
  type: OperationType;
  amount: bigint;
}

export interface ClosingTotals {
  depositsTotal: bigint;
  correctionsTotal: bigint;
  /** Deposits minus corrections; negative when only corrections were counted. */
  expectedTotal: bigint;
}

/**
 * What should be in the drawer (13): the deposits, minus the corrections,
 * since a corrected deposit's cash was not really received.
 */
export function closingTotals(operations: CountedOperation[]): ClosingTotals {
  let depositsTotal = 0n;
  let correctionsTotal = 0n;
  for (const operation of operations) {
    if (operation.type === OperationType.DEPOSIT) {
      depositsTotal += operation.amount;
    } else {
      correctionsTotal += operation.amount;
    }
  }
  return {
    depositsTotal,
    correctionsTotal,
    expectedTotal: depositsTotal - correctionsTotal,
  };
}
