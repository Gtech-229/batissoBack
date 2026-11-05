import { ConflictException, NotFoundException } from '@nestjs/common';
import type { StoreStatus } from '../generated/prisma/client.js';
import { STORE_STATUS_LABELS } from '../stores/store-lifecycle.js';

/** The two registration documents (21b), as named in the URLs. */
export const STORE_DOCUMENT_KINDS = ['identity', 'trade-register'] as const;
export type StoreDocumentKind = (typeof STORE_DOCUMENT_KINDS)[number];

export const DOCUMENT_REQUIRED =
  'La photo du document est requise, dans le champ « photo »';

/** Documents are sent while the store waits for its verification only. */
export function storeNotPending(status: StoreStatus): ConflictException {
  return new ConflictException({
    message: `Cette quincaillerie est ${STORE_STATUS_LABELS[status]} : ses documents ne peuvent être envoyés qu’avant sa vérification`,
    error: 'STORE_NOT_PENDING',
  });
}

/** The document was never sent (or its file is missing on the server). */
export function noStoreDocument(): NotFoundException {
  return new NotFoundException('Ce document n’a pas été envoyé');
}
