import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';

// `error` is the stable code the mobile app relies on; `message` is shown to users.

/** No such dispute on this account (or in this store): another's answers the same. */
export function disputeNotFound(): NotFoundException {
  return new NotFoundException('Contestation introuvable');
}

export function invalidDisputeId(): BadRequestException {
  return new BadRequestException('Identifiant de contestation invalide');
}

/** One dispute per operation at a time (a partial unique index). */
export function disputeAlreadyOpen(): ConflictException {
  return new ConflictException({
    message:
      'Une contestation est déjà en cours sur cette opération : écrivez-y plutôt que d’en ouvrir une autre',
    error: 'DISPUTE_ALREADY_OPEN',
  });
}

/** A closed dispute is final: a later disagreement is a new dispute. */
export function disputeClosed(): ConflictException {
  return new ConflictException({
    message:
      'Cette contestation est close : ouvrez une nouvelle contestation sur l’opération si besoin',
    error: 'DISPUTE_STATUS',
  });
}
