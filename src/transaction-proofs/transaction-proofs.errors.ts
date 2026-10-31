import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';

// `error` is the stable code the apps rely on; `message` is shown to users.

/** Live proofs of one deposit or one order (user decision, 2026-10-31). */
export const MAX_PROOFS_PER_TARGET = 5;

export function proofNotFound(): NotFoundException {
  return new NotFoundException('Preuve introuvable');
}

export function invalidProofId(): BadRequestException {
  return new BadRequestException('Identifiant de preuve invalide');
}

export function proofLimitReached(): ConflictException {
  return new ConflictException({
    message: `${MAX_PROOFS_PER_TARGET} preuves au plus par opération ou par bon`,
    error: 'PROOF_LIMIT_REACHED',
  });
}

/** Only a deposit takes a proof as an operation: a purchase's goes on its order. */
export function proofTargetNotAllowed(): ConflictException {
  return new ConflictException({
    message: 'Une preuve se joint à un dépôt ou à un bon',
    error: 'PROOF_TARGET_NOT_ALLOWED',
  });
}
