/**
 * A human number from a database sequence value: a prefix, a dash, and at
 * least `minDigits` digits, zero-padded (`C-000123`, `D-00482`, `B-00042`).
 * Past the padding it simply grows (`D-123456`), so numbers never run out or
 * wrap. Account numbers, deposit references, and order references all use it.
 */
export function formatSequenceNumber(
  prefix: string,
  minDigits: number,
  sequenceValue: bigint,
): string {
  return `${prefix}-${sequenceValue.toString().padStart(minDigits, '0')}`;
}
