import { ConflictException } from '@nestjs/common';

/** Rows of an exported file: it is built in memory, so it stays bounded. */
export const EXPORT_MAX_ROWS = 5000;

export function exportTooLarge(): ConflictException {
  return new ConflictException({
    message: `Cet export dépasse ${EXPORT_MAX_ROWS} lignes : filtrez-le par statut`,
    error: 'EXPORT_TOO_LARGE',
  });
}
