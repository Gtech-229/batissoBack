import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';

// `error` is the stable code the web admin relies on; `message` is shown to users.

export function roleNotFound(): NotFoundException {
  return new NotFoundException('Rôle introuvable');
}

export function invalidRoleId(): BadRequestException {
  return new BadRequestException('Identifiant de rôle invalide');
}

export function roleNameTaken(): ConflictException {
  return new ConflictException({
    message: 'Un rôle porte déjà ce nom',
    error: 'ROLE_NAME_TAKEN',
  });
}

export function roleInUse(): ConflictException {
  return new ConflictException({
    message:
      'Ce rôle est donné à des administrateurs : donnez-leur un autre rôle avant de le supprimer',
    error: 'ROLE_IN_USE',
  });
}

/** The super admin holds every permission by design: no role applies. */
export function superAdminHasNoRole(): ConflictException {
  return new ConflictException({
    message:
      'Le super administrateur a toutes les permissions : il n’a pas de rôle',
    error: 'SUPER_ADMIN_HAS_NO_ROLE',
  });
}
