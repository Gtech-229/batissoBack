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

/** A seller cancels only the orders they prepared (user decision, 2026-10-26). */
export function notOrderPreparer(): ForbiddenException {
  return new ForbiddenException({
    message:
      'Vous ne pouvez annuler que les bons que vous avez préparés : demandez au gérant',
    error: 'NOT_ORDER_PREPARER',
  });
}
