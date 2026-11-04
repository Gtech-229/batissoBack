import {
  BadRequestException,
  ForbiddenException,
  UnauthorizedException,
} from '@nestjs/common';

// `error` is the stable code client apps rely on; `message` is shown to users.

export function invalidCredentials(): UnauthorizedException {
  return new UnauthorizedException({
    message: 'Email ou mot de passe incorrect',
    error: 'INVALID_CREDENTIALS',
  });
}

export function invalidRefreshToken(): UnauthorizedException {
  return new UnauthorizedException({
    message: 'Session expirée, reconnectez-vous',
    error: 'INVALID_REFRESH_TOKEN',
  });
}

export function accountLocked(minutesLeft: number): ForbiddenException {
  const minutes = minutesLeft > 1 ? `${minutesLeft} minutes` : '1 minute';
  return new ForbiddenException({
    message: `Compte temporairement bloqué. Réessayez dans ${minutes}.`,
    error: 'ACCOUNT_LOCKED',
  });
}

/** No usable session: the French default "Authentification requise" applies. */
export function notAuthenticated(): UnauthorizedException {
  return new UnauthorizedException();
}

/** Role not allowed: the French default "Accès refusé" applies. */
export function forbidden(): ForbiddenException {
  return new ForbiddenException();
}

/** Wrong, expired, used, or replaced password link, or an inactive admin. */
export function invalidPasswordToken(): BadRequestException {
  return new BadRequestException({
    message: 'Ce lien n’est plus valable : demandez-en un nouveau',
    error: 'INVALID_PASSWORD_TOKEN',
  });
}

export function passwordUnchanged(): BadRequestException {
  return new BadRequestException(
    'Le nouveau mot de passe doit être différent de l’actuel',
  );
}

export function accountDisabled(): ForbiddenException {
  return new ForbiddenException({
    message: 'Ce compte administrateur est désactivé',
    error: 'ACCOUNT_DISABLED',
  });
}
