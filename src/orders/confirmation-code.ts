import { randomInt } from 'node:crypto';
import { groupThousands } from '../notifications/messages.js';

/** How long a texted code confirms its order. */
export const CONFIRMATION_CODE_TTL_MS = 10 * 60_000;
/** The least time between two codes for one order. */
export const CONFIRMATION_CODE_COOLDOWN_MS = 60_000;
/** Codes one order may receive in all: bounds code guessing and SMS cost. */
export const MAX_CODES_PER_ORDER = 5;
/** Wrong entries that use a code up: a new code is then needed. */
export const MAX_CODE_ATTEMPTS = 5;

const CODE_LENGTH = 6;

/** A random 6-digit code, zero-padded. */
export function newConfirmationCode(): string {
  return randomInt(0, 10 ** CODE_LENGTH)
    .toString()
    .padStart(CODE_LENGTH, '0');
}

/**
 * The SMS the customer receives: what they confirm (the order, the amount, the
 * store), how long the code works, and who may hear it. French, like every
 * message users see.
 */
export function confirmationCodeMessage(order: {
  code: string;
  reference: string;
  total: bigint;
  currencyCode: string;
  storeName: string;
}): string {
  return `Bâtisso : code ${order.code} pour confirmer le bon ${order.reference} de ${groupThousands(order.total)} ${order.currencyCode} chez ${order.storeName}. Valable 10 minutes. Donnez-le au vendeur seulement pour confirmer cet achat.`;
}
