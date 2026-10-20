import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { invalidFields } from '../stores/stores.errors.js';

// `error` is the stable code the mobile app relies on; `message` is shown to users.

/** Ends the 409 STORE_NOT_VERIFIED message of a deposit. */
export const DEPOSIT_REFUSAL = 'elle ne peut recevoir aucun dépôt';

export const IDEMPOTENCY_KEY_RULE =
  'L’en-tête Idempotency-Key est requis : un UUID généré par l’application pour cette demande, renvoyé tel quel si elle est répétée';

/** A French 400 on the `Idempotency-Key` header. */
export function invalidIdempotencyKey(): BadRequestException {
  return invalidFields([
    { field: 'Idempotency-Key', errors: [IDEMPOTENCY_KEY_RULE] },
  ]);
}

/** No such operation on this account: another account's answers the same. */
export function operationNotFound(): NotFoundException {
  return new NotFoundException('Opération introuvable');
}

export function invalidOperationId(): BadRequestException {
  return new BadRequestException('Identifiant d’opération invalide');
}

/** The key already recorded a different operation: a retry must reuse its own key. */
export function idempotencyKeyReused(): ConflictException {
  return new ConflictException({
    message:
      'Cette clé d’idempotence a déjà servi pour une autre opération : générez une nouvelle clé pour un nouveau dépôt',
    error: 'IDEMPOTENCY_KEY_REUSED',
  });
}

/** A seller never records cash into their own savings (user decision, 2026-10-20). */
export function ownAccountDeposit(): ConflictException {
  return new ConflictException({
    message:
      'Vous ne pouvez pas enregistrer un dépôt sur votre propre compte : demandez à un collègue ou au gérant',
    error: 'OWN_ACCOUNT',
  });
}

export function belowMinDeposit(
  minimum: string,
  currencyCode: string,
): ConflictException {
  return new ConflictException({
    message: `Le dépôt minimum de cette quincaillerie est de ${minimum} ${currencyCode}`,
    error: 'BELOW_MIN_DEPOSIT',
  });
}

export function maxBalanceExceeded(
  maximum: string,
  room: string,
  currencyCode: string,
): ConflictException {
  return new ConflictException({
    message: `Ce dépôt dépasserait le solde maximal du compte (${maximum} ${currencyCode}) : au plus ${room} ${currencyCode} peuvent encore être déposés`,
    error: 'MAX_BALANCE_EXCEEDED',
  });
}
