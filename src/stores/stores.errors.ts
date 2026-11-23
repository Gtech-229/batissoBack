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

/** "One store ever" (21b): the user already registered one, whatever its status. */
export function storeAlreadyRegistered(): ConflictException {
  return new ConflictException({
    message:
      'Vous avez déjà inscrit une quincaillerie : chaque utilisateur ne peut en inscrire qu’une',
    error: 'STORE_ALREADY_REGISTERED',
  });
}

/**
 * Store registration from the app (21b, 27): the manager's phone country is
 * not open. Same code as an admin registration in an inactive country, with a
 * message for the app's user.
 */
export function countryNotOpen(): ConflictException {
  return new ConflictException({
    message:
      'Ikasso n’est pas encore ouvert dans votre pays : l’inscription d’une quincaillerie y est impossible pour le moment',
    error: 'COUNTRY_INACTIVE',
  });
}

/** A self-registered store is verified once both of its documents are sent. */
export function storeDocumentsMissing(documents: {
  identity: boolean;
  tradeRegister: boolean;
}): ConflictException {
  const missing = [
    ...(documents.identity ? [] : ['la pièce d’identité du gérant']),
    ...(documents.tradeRegister ? [] : ['le registre du commerce']),
  ].join(' et ');
  return new ConflictException({
    message: `Impossible de vérifier cette quincaillerie : il manque ${missing}`,
    error: 'STORE_DOCUMENTS_MISSING',
  });
}

/** A store import file refused as a whole (26a): nothing in it is checked. */
export function importFileRefused(
  code: string,
  message: string,
): BadRequestException {
  return new BadRequestException({ message, error: code });
}

export const IMPORT_FILE_MISSING =
  'Joignez le fichier à importer (.csv ou .xlsx) dans le champ « file »';
export const IMPORT_FILE_TOO_LARGE = 'Le fichier dépasse 2 Mo';
export const IMPORT_BODY_INVALID =
  'Envoyez un seul fichier (.csv ou .xlsx) dans le champ « file », et rien d’autre';

/** A row's cell that holds a date, a true/false or an Excel error. */
export const IMPORT_CELL_UNREADABLE =
  'Valeur illisible : saisissez-la comme du texte ou un nombre';
export const IMPORT_DUPLICATE_IN_FILE = (row: number) =>
  `Ce registre du commerce figure déjà à la ligne ${row} du fichier, pour ce pays`;
export const IMPORT_DUPLICATE_REGISTERED =
  'Une quincaillerie de ce pays est déjà inscrite avec ce registre du commerce';
