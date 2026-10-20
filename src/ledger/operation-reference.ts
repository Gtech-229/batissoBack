/** Digits a reference shows at least, zero-padded: D-00482. */
const MIN_DIGITS = 5;

/**
 * The reference of a deposit for a value of `operation_reference_deposit_seq`:
 * "D-" + at least five digits. Past 99999 it simply grows (D-123456).
 */
export function formatDepositReference(sequenceValue: bigint): string {
  return `D-${sequenceValue.toString().padStart(MIN_DIGITS, '0')}`;
}
