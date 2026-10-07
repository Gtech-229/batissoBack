import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { VALIDATION_ERROR_MESSAGE } from '../common/errors/error-messages.js';
import type { ValidationErrorDetail } from '../common/errors/error-response.js';

export function storeNotFound(): NotFoundException {
  return new NotFoundException('Quincaillerie introuvable');
}

export function invalidStoreId(): BadRequestException {
  return new BadRequestException('Identifiant de quincaillerie invalide');
}

export function countryInactive(code: string): ConflictException {
  return new ConflictException({
    message: `Le pays ${code} n’est pas actif : activez-le avant d’y inscrire une quincaillerie`,
    error: 'COUNTRY_INACTIVE',
  });
}

/**
 * Field errors found by the service (rules that depend on other fields or on
 * the database), in the same shape as the ValidationPipe's errors.
 */
export function invalidFields(
  details: ValidationErrorDetail[],
): BadRequestException {
  return new BadRequestException({
    message: VALIDATION_ERROR_MESSAGE,
    details,
  });
}

export const PHONE_NOT_OF_COUNTRY = (code: string) =>
  `Ce numéro n’est pas un numéro valide du pays ${code}`;
export const MIN_DEPOSIT_ABOVE_MAX_BALANCE =
  'Le dépôt minimum ne peut pas dépasser le solde maximal';

export function storeClosed(): ConflictException {
  return new ConflictException({
    message: 'Cette quincaillerie est fermée : elle ne peut plus être modifiée',
    error: 'STORE_CLOSED',
  });
}

export function invalidStatusTransition(
  action: string,
  currentStatus: string,
): ConflictException {
  return new ConflictException({
    message: `Impossible de ${action} une quincaillerie ${currentStatus}`,
    error: 'INVALID_STATUS_TRANSITION',
  });
}
