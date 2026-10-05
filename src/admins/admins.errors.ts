import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';

export function emailAlreadyUsed(): ConflictException {
  return new ConflictException({
    message: 'Cet email est déjà utilisé',
    error: 'EMAIL_ALREADY_USED',
  });
}

export function adminNotFound(): NotFoundException {
  return new NotFoundException('Administrateur introuvable');
}

export function invalidAdminId(): BadRequestException {
  return new BadRequestException('Identifiant d’administrateur invalide');
}

/** Self or a super admin: these accounts are never activated/deactivated here. */
export function protectedAdmin(): ForbiddenException {
  return new ForbiddenException(
    'Impossible de modifier votre propre compte ou celui d’un super administrateur',
  );
}
