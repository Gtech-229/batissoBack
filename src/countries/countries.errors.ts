import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';

export function countryAlreadyExists(): ConflictException {
  return new ConflictException({
    message: 'Un pays avec ce code existe déjà',
    error: 'COUNTRY_ALREADY_EXISTS',
  });
}

/** A valid ISO code that the phone library cannot handle (no calling code). */
export function unsupportedCountryCode(code: string): BadRequestException {
  return new BadRequestException(
    `Le code pays ${code} n’est pas pris en charge (indicatif téléphonique inconnu)`,
  );
}

export function countryInUse(message: string): ConflictException {
  return new ConflictException({ message, error: 'COUNTRY_IN_USE' });
}

export function countryNotFound(): NotFoundException {
  return new NotFoundException('Pays introuvable');
}
