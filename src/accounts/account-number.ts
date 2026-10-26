import { formatSequenceNumber } from '../common/sequence-number.js';

/**
 * The account number for a value of `account_number_seq`: "C-" + at least six
 * digits (C-000123). Past 999999 it simply grows, so numbers never run out.
 */
export function formatAccountNumber(sequenceValue: bigint): string {
  return formatSequenceNumber('C', 6, sequenceValue);
}
