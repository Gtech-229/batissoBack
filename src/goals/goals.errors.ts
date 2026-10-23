import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';

// `error` is the stable code the mobile app relies on; `message` is shown to users.

export function goalNotFound(): NotFoundException {
  return new NotFoundException('Objectif introuvable');
}

export function projectNotFound(): NotFoundException {
  return new NotFoundException('Projet introuvable');
}

export function invalidGoalId(): BadRequestException {
  return new BadRequestException('Identifiant d’objectif invalide');
}

/** The Unassigned goal is never renamed, retargeted, or closed. */
export function systemGoal(): ConflictException {
  return new ConflictException({
    message:
      'L’objectif « Non affecté » ne peut être ni renommé, ni modifié, ni fermé',
    error: 'SYSTEM_GOAL',
  });
}

export function goalClosed(): ConflictException {
  return new ConflictException({
    message: 'Cet objectif est fermé',
    error: 'GOAL_CLOSED',
  });
}

export function nothingToUpdate(): BadRequestException {
  return new BadRequestException(
    'Indiquez un nouveau libellé, un nouveau montant visé ou un article',
  );
}

export function sameGoal(): BadRequestException {
  return new BadRequestException(
    'L’objectif de départ et celui d’arrivée doivent être différents',
  );
}

/** The source goal holds less than the amount: the message gives what it holds. */
export function insufficientGoalBalance(
  available: string,
  currencyCode: string,
): ConflictException {
  return new ConflictException({
    message: `Cet objectif ne contient que ${available} ${currencyCode}`,
    error: 'INSUFFICIENT_GOAL_BALANCE',
  });
}

/** The key already recorded another movement: a retry must reuse its own key. */
export function movementKeyReused(): ConflictException {
  return new ConflictException({
    message:
      'Cette clé d’idempotence a déjà servi pour une autre opération : générez une nouvelle clé pour un nouveau mouvement',
    error: 'IDEMPOTENCY_KEY_REUSED',
  });
}
