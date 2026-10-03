import { HttpStatus } from '@nestjs/common';

export const VALIDATION_ERROR_MESSAGE = 'Données invalides';
export const FALLBACK_ERROR_MESSAGE = 'Une erreur est survenue';

/** French message used when an exception carries no message written by our code. */
export const DEFAULT_ERROR_MESSAGES: Partial<Record<HttpStatus, string>> = {
  [HttpStatus.BAD_REQUEST]: 'Requête invalide',
  [HttpStatus.UNAUTHORIZED]: 'Authentification requise',
  [HttpStatus.FORBIDDEN]: 'Accès refusé',
  [HttpStatus.NOT_FOUND]: 'Ressource introuvable',
  [HttpStatus.CONFLICT]: "Conflit avec l'état actuel de la ressource",
  [HttpStatus.UNPROCESSABLE_ENTITY]: 'Données impossibles à traiter',
  [HttpStatus.INTERNAL_SERVER_ERROR]: 'Une erreur interne est survenue',
  [HttpStatus.SERVICE_UNAVAILABLE]: 'Service temporairement indisponible',
};
