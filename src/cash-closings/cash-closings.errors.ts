import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';

// `error` is the stable code the mobile app relies on; `message` is shown to users.

/** No such closing in this store: another store's answers the same. */
export function closingNotFound(): NotFoundException {
  return new NotFoundException('Clôture introuvable');
}

export function invalidClosingId(): BadRequestException {
  return new BadRequestException('Identifiant de clôture invalide');
}

/** The count differs from what is expected: the difference must be explained. */
export function justificationRequired(
  expected: string,
  discrepancy: string,
  currencyCode: string,
): ConflictException {
  return new ConflictException({
    message: `Le montant attendu est de ${expected} ${currencyCode}, soit un écart de ${discrepancy} ${currencyCode} : expliquez cet écart`,
    error: 'JUSTIFICATION_REQUIRED',
  });
}

/** The key already made another closing: a new closing needs a new key. */
export function closingKeyReused(): ConflictException {
  return new ConflictException({
    message:
      'Cette clé d’idempotence a déjà servi pour une autre clôture : générez une nouvelle clé pour une nouvelle clôture',
    error: 'IDEMPOTENCY_KEY_REUSED',
  });
}
