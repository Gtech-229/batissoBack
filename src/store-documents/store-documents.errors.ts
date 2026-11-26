import { NotFoundException } from '@nestjs/common';

/** The two registration documents (21b), as named in the URLs. */
export const STORE_DOCUMENT_KINDS = ['identity', 'trade-register'] as const;
export type StoreDocumentKind = (typeof STORE_DOCUMENT_KINDS)[number];

export const DOCUMENT_REQUIRED =
  'La photo du document est requise, dans le champ « photo »';

/** The document was never sent (or its file is missing on the server). */
export function noStoreDocument(): NotFoundException {
  return new NotFoundException('Ce document n’a pas été envoyé');
}
