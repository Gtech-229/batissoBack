import { ConflictException } from '@nestjs/common';
import { StoreStatus, type Prisma } from '../generated/prisma/client.js';
import { STORE_STATUS_LABELS } from '../stores/store-lifecycle.js';
import { storeNotFound } from '../stores/stores.errors.js';

/** What a change in a verified store needs to know about it. */
export interface VerifiedStore {
  countryCode: string;
  /** The country's currency (ISO 4217). */
  currencyCode: string;
}

/**
 * 409 for a change refused because the store is not verified. `refusal` ends
 * the message: what cannot happen until it is, e.g. "son équipe ne peut être
 * modifiée qu’une fois vérifiée".
 */
export function storeNotVerified(
  status: StoreStatus,
  refusal: string,
): ConflictException {
  return new ConflictException({
    message: `Cette quincaillerie est ${STORE_STATUS_LABELS[status]} : ${refusal}`,
    error: 'STORE_NOT_VERIFIED',
  });
}

/**
 * Reads the store `FOR SHARE` inside the caller's transaction and requires it
 * VERIFIED: a concurrent status change (which locks the row) waits for this
 * change, or the reverse, so nothing changes in a store that was just
 * suspended or closed. `refusal` completes the 409 message.
 */
export async function lockVerifiedStore(
  tx: Prisma.TransactionClient,
  storeId: string,
  refusal: string,
): Promise<VerifiedStore> {
  const [row] = await tx.$queryRaw<
    { status: StoreStatus; countryCode: string; currencyCode: string }[]
  >`SELECT s."status", s."countryCode", c."currencyCode"
    FROM "hardware_stores" s JOIN "countries" c ON c."code" = s."countryCode"
    WHERE s."id" = ${storeId}::uuid
    FOR SHARE OF s`;
  if (!row) {
    throw storeNotFound();
  }
  if (row.status !== StoreStatus.VERIFIED) {
    throw storeNotVerified(row.status, refusal);
  }
  return { countryCode: row.countryCode, currencyCode: row.currencyCode };
}
