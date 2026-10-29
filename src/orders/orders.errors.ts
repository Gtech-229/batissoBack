import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { MaterialOrderStatus } from '../generated/prisma/client.js';

/** How each status reads in a French message ("Ce bon est ..."). */
export const ORDER_STATUS_LABELS: Record<MaterialOrderStatus, string> = {
  [MaterialOrderStatus.AWAITING_VALIDATION]: 'en attente de validation',
  [MaterialOrderStatus.AWAITING_CUSTOMER]: 'en attente du client',
  [MaterialOrderStatus.REFUSED_BY_MANAGER]: 'refusé par le gérant',
  [MaterialOrderStatus.CANCELLED]: 'annulé',
  [MaterialOrderStatus.CONFIRMED]: 'confirmé par le client',
  [MaterialOrderStatus.REFUSED_BY_CUSTOMER]: 'refusé par le client',
  [MaterialOrderStatus.DELIVERED]: 'livré',
  [MaterialOrderStatus.CANCELLED_AFTER_DEBIT]: 'annulé après débit',
};

// `error` is the stable code the mobile app relies on; `message` is shown to users.

export function orderNotFound(): NotFoundException {
  return new NotFoundException('Bon introuvable');
}

export function invalidOrderId(): BadRequestException {
  return new BadRequestException('Identifiant de bon invalide');
}

/** Staff never prepare an order on their own savings, as for deposits. */
export function ownAccountOrder(): ConflictException {
  return new ConflictException({
    message:
      'Vous ne pouvez pas préparer un bon sur votre propre compte : demandez à un collègue ou au gérant',
    error: 'OWN_ACCOUNT',
  });
}

/**
 * The order costs more than the chosen goal and Unassigned hold together
 * (user decision, 2026-10-26): the message gives what is available.
 */
export function insufficientBalance(
  total: string,
  available: string,
  currencyCode: string,
): ConflictException {
  return new ConflictException({
    message: `Ce bon de ${total} ${currencyCode} dépasse ce qui est disponible : ${available} ${currencyCode} (objectif choisi et « Non affecté »)`,
    error: 'INSUFFICIENT_BALANCE',
  });
}

/** The order is not in a status that allows this step: the message gives where it stands. */
export function orderStatusConflict(
  status: MaterialOrderStatus,
): ConflictException {
  return new ConflictException({
    message: `Ce bon est ${ORDER_STATUS_LABELS[status]} : cette action n’est pas possible`,
    error: 'ORDER_STATUS',
  });
}

/** Wrong, expired, replaced, or used-up code: one answer for all (no hint). */
export function invalidCode(): BadRequestException {
  return new BadRequestException({
    message: 'Code incorrect ou expiré : demandez un nouveau code',
    error: 'INVALID_CODE',
  });
}

/** A code was sent less than a minute ago for this order. */
export function codeCooldown(secondsLeft: number): ConflictException {
  return new ConflictException({
    message: `Un code vient d’être envoyé : réessayez dans ${secondsLeft} s`,
    error: 'CODE_COOLDOWN',
  });
}

/** The order already received its maximum of codes. */
export function codeLimit(): ConflictException {
  return new ConflictException({
    message:
      'Ce bon a reçu le nombre maximal de codes : annulez-le et préparez-en un nouveau',
    error: 'CODE_LIMIT',
  });
}

/** The key already recorded another operation: a new confirmation needs a new key. */
export function orderKeyReused(): ConflictException {
  return new ConflictException({
    message:
      'Cette clé d’idempotence a déjà servi pour une autre opération : générez une nouvelle clé pour une nouvelle confirmation',
    error: 'IDEMPOTENCY_KEY_REUSED',
  });
}

/** A seller cancels only the orders they prepared (user decision, 2026-10-26). */
export function notOrderPreparer(): ForbiddenException {
  return new ForbiddenException({
    message:
      'Vous ne pouvez annuler que les bons que vous avez préparés : demandez au gérant',
    error: 'NOT_ORDER_PREPARER',
  });
}

/** The key already recorded another operation: a new cancellation needs a new key. */
export function cancellationKeyReused(): ConflictException {
  return new ConflictException({
    message:
      'Cette clé d’idempotence a déjà servi pour une autre opération : générez une nouvelle clé pour une nouvelle annulation',
    error: 'IDEMPOTENCY_KEY_REUSED',
  });
}

/** The customer already asked to cancel this order (11c): one request per order. */
export function cancellationAlreadyRequested(): ConflictException {
  return new ConflictException({
    message:
      'Vous avez déjà demandé l’annulation de ce bon : le gérant doit le livrer ou l’annuler',
    error: 'CANCELLATION_ALREADY_REQUESTED',
  });
}

/** The store's delivery delay has not passed since the confirmation (11c). */
export function deliveryDelayNotReached(opensOn: string): ConflictException {
  return new ConflictException({
    message: `Vous pourrez demander l’annulation de ce bon à partir du ${opensOn}`,
    error: 'DELIVERY_DELAY_NOT_REACHED',
  });
}
