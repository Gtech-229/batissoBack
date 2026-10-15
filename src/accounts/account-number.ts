/** Digits an account number shows at least, zero-padded: C-000123. */
const MIN_DIGITS = 6;

/**
 * The account number for a value of `account_number_seq`: "C-" + at least six
 * digits. Past 999999 it simply grows (C-1234567), so numbers never run out.
 */
export function formatAccountNumber(sequenceValue: bigint): string {
  return `C-${sequenceValue.toString().padStart(MIN_DIGITS, '0')}`;
}
