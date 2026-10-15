import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';

// `error` is the stable code the mobile app relies on; `message` is shown to users.

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
