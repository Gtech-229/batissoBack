import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';

// `error` is the stable code the mobile app relies on; `message` is shown to users.

/** Ends the 409 STORE_NOT_VERIFIED message of an account opening. */
export const OPENING_REFUSAL =
  'aucun compte ne peut y être ouvert avant sa vérification';

/** No such account in this store: an account of another store answers the same. */
export function accountNotFound(): NotFoundException {
  return new NotFoundException('Compte introuvable');
}

export function invalidAccountId(): BadRequestException {
  return new BadRequestException('Identifiant de compte invalide');
}

/** Suspend only an active account, reactivate only a suspended one (16b). */
export function invalidAccountTransition(
  action: 'suspend' | 'reactivate',
): ConflictException {
  return new ConflictException({
    message:
      action === 'suspend'
        ? 'Ce compte est déjà suspendu'
        : 'Ce compte n’est pas suspendu',
    error: 'INVALID_STATUS_TRANSITION',
  });
}

/** A suspended account takes no deposit and no goal move (16b). */
export function accountSuspended(): ConflictException {
  return new ConflictException({
    message:
      'Ce compte est suspendu : il ne prend plus de dépôts ni de mouvements entre objectifs. Les achats restent possibles.',
    error: 'ACCOUNT_SUSPENDED',
  });
}

/** One account per customer and store. */
export function accountExists(): ConflictException {
  return new ConflictException({
    message: 'Ce client a déjà un compte dans cette quincaillerie',
    error: 'ACCOUNT_EXISTS',
  });
}

/** Staff never open an account for themselves at their own counter. */
export function ownAccount(): ConflictException {
  return new ConflictException({
    message:
      'Vous ne pouvez pas ouvrir un compte à votre propre nom : demandez à un collègue ou au gérant',
    error: 'OWN_ACCOUNT',
  });
}
