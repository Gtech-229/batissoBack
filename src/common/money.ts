import { applyDecorators } from '@nestjs/common';
import { IsString, Matches } from 'class-validator';

/**
 * Money convention: integers in the currency's smallest unit (XOF has none),
 * stored as BigInt and exchanged as decimal strings ("200000"), because JSON
 * numbers lose precision on large values and BigInt cannot be serialized.
 */

// Positive, no sign, no decimals, no leading zero, at most 18 digits (always
// below the PostgreSQL BIGINT maximum of about 9.22e18).
const AMOUNT_PATTERN = /^[1-9][0-9]{0,17}$/;

export const AMOUNT_RULE_MESSAGE =
  'Le montant doit être un entier positif écrit en chiffres, sans décimales (ex. "200000")';

export function isAmount(value: unknown): value is string {
  return typeof value === 'string' && AMOUNT_PATTERN.test(value);
}

/** Converts a validated amount string to BigInt. Throws on anything else. */
export function parseAmount(value: string): bigint {
  if (!isAmount(value)) {
    throw new Error(`Invalid amount: ${JSON.stringify(value)}`);
  }
  return BigInt(value);
}

export function formatAmount(value: bigint): string {
  return value.toString();
}

/** DTO decorator for an amount field. */
export function IsAmount(): PropertyDecorator {
  return applyDecorators(
    IsString({ message: AMOUNT_RULE_MESSAGE }),
    Matches(AMOUNT_PATTERN, { message: AMOUNT_RULE_MESSAGE }),
  );
}
