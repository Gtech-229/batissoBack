import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import type { StoreStatus } from '../generated/prisma/client.js';
import { STORE_STATUS_LABELS } from '../stores/store-lifecycle.js';

// `error` is the stable code the mobile app relies on; `message` is shown to users.

/** Team changes need a verified store; the message names its current status. */
export function storeNotVerified(status: StoreStatus): ConflictException {
  return new ConflictException({
    message: `Cette quincaillerie est ${STORE_STATUS_LABELS[status]} : son équipe ne peut être modifiée qu’une fois vérifiée`,
    error: 'STORE_NOT_VERIFIED',
  });
}

/** An active seller, or a manager, of this store already has this phone. */
export function alreadyMember(): ConflictException {
  return new ConflictException({
    message: 'Ce numéro fait déjà partie de l’équipe de cette quincaillerie',
    error: 'ALREADY_MEMBER',
  });
}

export function sellerNotFound(): NotFoundException {
  return new NotFoundException('Vendeur introuvable');
}

export function invalidUserId(): BadRequestException {
  return new BadRequestException('Identifiant de vendeur invalide');
}

export function alreadyInactive(): ConflictException {
  return new ConflictException({
    message: 'Ce vendeur est déjà désactivé',
    error: 'ALREADY_INACTIVE',
  });
}

export function alreadyActive(): ConflictException {
  return new ConflictException({
    message: 'Ce vendeur est déjà actif',
    error: 'ALREADY_ACTIVE',
  });
}
