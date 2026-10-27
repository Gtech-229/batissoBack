import { formatSequenceNumber } from '../common/sequence-number.js';

/**
 * The reference of a deposit for a value of `operation_reference_deposit_seq`:
 * "D-" + at least five digits (D-00482). Past 99999 it simply grows.
 */
export function formatDepositReference(sequenceValue: bigint): string {
  return formatSequenceNumber('D', 5, sequenceValue);
}

/**
 * The reference of a material purchase debit (10b) for a value of
 * `operation_reference_purchase_seq`: "A-" (achat) + at least five digits
 * (A-00001), distinct from the order's own B- number.
 */
export function formatPurchaseReference(sequenceValue: bigint): string {
  return formatSequenceNumber('A', 5, sequenceValue);
}

/**
 * The reference of a manager's correction (11a) for a value of
 * `operation_reference_correction_seq`: "R-" (rectification) + at least five
 * digits (R-00001).
 */
export function formatCorrectionReference(sequenceValue: bigint): string {
  return formatSequenceNumber('R', 5, sequenceValue);
}
