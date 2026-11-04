import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';

export function invalidSubscriptionPeriod(): BadRequestException {
  return new BadRequestException({
    message:
      'La date de fin doit être le même jour que la date de début ou après',
    error: 'INVALID_SUBSCRIPTION_PERIOD',
  });
}

export function subscriptionOverlap(): ConflictException {
  return new ConflictException({
    message:
      'Cette période chevauche un autre abonnement de la quincaillerie : corrigez les dates de l’un ou de l’autre',
    error: 'SUBSCRIPTION_OVERLAP',
  });
}

export function subscriptionNotFound(): NotFoundException {
  return new NotFoundException('Abonnement introuvable');
}

export function invalidSubscriptionId(): BadRequestException {
  return new BadRequestException('Identifiant d’abonnement invalide');
}

export function storeClosedForSubscription(): ConflictException {
  return new ConflictException({
    message:
      'Cette quincaillerie est fermée : elle ne peut plus recevoir d’abonnement',
    error: 'STORE_CLOSED',
  });
}
