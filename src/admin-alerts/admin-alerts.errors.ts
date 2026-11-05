import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';

export function alertNotFound(): NotFoundException {
  return new NotFoundException('Alerte introuvable');
}

export function invalidAlertId(): BadRequestException {
  return new BadRequestException('Identifiant d’alerte invalide');
}

export function alertAlreadyResolved(): ConflictException {
  return new ConflictException({
    message: 'Cette alerte est déjà marquée comme traitée',
    error: 'ALERT_ALREADY_RESOLVED',
  });
}
