import {
  BadRequestException,
  ForbiddenException,
  UnauthorizedException,
} from '@nestjs/common';
import { VALIDATION_ERROR_MESSAGE } from '../common/errors/error-messages.js';

// `error` is the stable code the mobile app relies on; `message` is shown to users.

/** Same answer for a wrong, expired, used, or dead code, and an unknown phone. */
export function invalidCode(): UnauthorizedException {
  return new UnauthorizedException({
    message: 'Code incorrect ou expiré. Demandez un nouveau code.',
    error: 'INVALID_CODE',
  });
}

/** A phone that is not a valid number of the active country, as a field error. */
export function invalidPhone(): BadRequestException {
  return new BadRequestException({
    message: VALIDATION_ERROR_MESSAGE,
    details: [
      {
        field: 'phone',
        errors: ['Ce numéro de téléphone n’est pas valide'],
      },
    ],
  });
}

/** The verification token is wrong, expired, already used, or was refused. */
export function invalidVerification(): UnauthorizedException {
  return new UnauthorizedException({
    message: 'Vérification expirée. Demandez un nouveau code par SMS.',
    error: 'INVALID_VERIFICATION',
  });
}

/** Same answer for an unknown phone, a user without PIN, and a wrong PIN. */
export function invalidCredentials(): UnauthorizedException {
  return new UnauthorizedException({
    message: 'Numéro ou code PIN incorrect',
    error: 'INVALID_CREDENTIALS',
  });
}

/** No live mobile session: the French default "Authentification requise" applies. */
export function notAuthenticated(): UnauthorizedException {
  return new UnauthorizedException();
}

/** The app must sign in again (PIN on this device). */
export function invalidRefreshToken(): UnauthorizedException {
  return new UnauthorizedException({
    message: 'Session expirée, reconnectez-vous',
    error: 'INVALID_REFRESH_TOKEN',
  });
}

/** Right PIN, but this device was never verified by SMS for this user. */
export function deviceVerificationRequired(): ForbiddenException {
  return new ForbiddenException({
    message:
      'Nouvel appareil : confirmez votre numéro avec le code reçu par SMS.',
    error: 'DEVICE_VERIFICATION_REQUIRED',
  });
}

/** A wrong PIN to approve an action (not a sign-in): the session stays open. */
export function invalidPin(): BadRequestException {
  return new BadRequestException({
    message: 'Code PIN incorrect',
    error: 'INVALID_PIN',
  });
}

/** A PIN change to the same PIN: nothing to change, no attempt counted. */
export function pinUnchanged(): BadRequestException {
  return new BadRequestException({
    message: 'Le nouveau code PIN doit être différent de l’actuel',
    error: 'PIN_UNCHANGED',
  });
}

export function pinLocked(minutesLeft: number): ForbiddenException {
  const minutes = minutesLeft > 1 ? `${minutesLeft} minutes` : '1 minute';
  return new ForbiddenException({
    message: `Trop de codes PIN erronés. Réessayez dans ${minutes}.`,
    error: 'PIN_LOCKED',
  });
}
