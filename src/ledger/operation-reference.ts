import { formatSequenceNumber } from '../common/sequence-number.js';

/**
 * The reference of a deposit for a value of `operation_reference_deposit_seq`:
 * "D-" + at least five digits (D-00482). Past 99999 it simply grows.
 */
export function formatDepositReference(sequenceValue: bigint): string {
  return formatSequenceNumber('D', 5, sequenceValue);
}
