import { ForbiddenException } from '@nestjs/common';

// `error` is the stable code the mobile app relies on; `message` is shown to users.

/** Managers are reset by admins, never by a manager (themselves included). */
export function managerResetNotAllowed(): ForbiddenException {
  return new ForbiddenException({
    message: 'L’accès d’un gérant ne peut pas être réinitialisé ici',
    error: 'MANAGER_RESET_NOT_ALLOWED',
  });
}
