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

/**
 * A closed account (28) takes no money action: no deposit, order, goal move,
 * correction, dispute, or admin status change. Joining again reopens it.
 */
export function accountClosed(): ConflictException {
  return new ConflictException({
    message:
      'Ce compte est fermé : il ne prend plus de dépôts, d’achats ni de mouvements entre objectifs. Rejoindre de nouveau la quincaillerie le rouvre.',
    error: 'ACCOUNT_CLOSED',
  });
}

/** Closing (28): only at a zero balance, as cash refunds are not offered. */
export function accountNotEmpty(): ConflictException {
  return new ConflictException({
    message:
      'Ce compte a encore un solde : il ne peut être fermé qu’à zéro, une fois l’épargne utilisée en achats de matériaux',
    error: 'ACCOUNT_NOT_EMPTY',
  });
}

/** Closing (28): an order is still to validate, to confirm or to deliver. */
export function orderInProgress(): ConflictException {
  return new ConflictException({
    message:
      'Un bon de matériaux de ce compte est encore en cours (à valider, à confirmer ou à livrer) : il doit être terminé avant la fermeture du compte',
    error: 'ORDER_IN_PROGRESS',
  });
}

/** Closing (28): a dispute is still open or answered. */
export function disputeInProgress(): ConflictException {
  return new ConflictException({
    message:
      'Une contestation de ce compte est encore ouverte : elle doit être close avant la fermeture du compte',
    error: 'DISPUTE_IN_PROGRESS',
  });
}

/**
 * Closing (28): an admin's suspension stays until an admin lifts it, so leaving
 * and joining again cannot clear it.
 */
export function suspendedAccountNotClosable(): ConflictException {
  return new ConflictException({
    message:
      'Ce compte est suspendu par un administrateur : il ne peut pas être fermé avant sa réactivation',
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

/** Joining (21c): the user's phone is not a number of the store's country. */
export function phoneNotOfStoreCountry(): ConflictException {
  return new ConflictException({
    message:
      'Votre numéro n’est pas un numéro du pays de cette quincaillerie : vous ne pouvez pas y ouvrir de compte',
    error: 'PHONE_NOT_OF_STORE_COUNTRY',
  });
}
