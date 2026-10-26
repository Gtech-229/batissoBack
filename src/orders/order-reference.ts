import { formatSequenceNumber } from '../common/sequence-number.js';

/**
 * The reference of a material order ("bon") for a value of
 * `material_order_reference_seq`: "B-" + at least five digits (B-00042), the
 * same scheme as deposit references. Past 99999 it simply grows.
 */
export function formatOrderReference(sequenceValue: bigint): string {
  return formatSequenceNumber('B', 5, sequenceValue);
}
