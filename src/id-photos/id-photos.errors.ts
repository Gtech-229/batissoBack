import { NotFoundException, type BadRequestException } from '@nestjs/common';
import { invalidFields } from '../stores/stores.errors.js';

/** Maximum size of an identity photo: 5 MB (decided by the user, 2026-10-15). */
export const MAX_PHOTO_BYTES = 5 * 1024 * 1024;

/** Ends the 409 STORE_NOT_VERIFIED message of an upload. */
export const PHOTO_REFUSAL =
  'aucune photo d’identité ne peut y être enregistrée avant sa vérification';

export const PHOTO_REQUIRED =
  'La photo d’identité est requise, dans le champ « photo »';
export const PHOTO_TYPE = 'La photo doit être une image JPEG ou PNG';
export const PHOTO_TOO_LARGE = 'La photo ne doit pas dépasser 5 Mo';
// Also covers a malformed or truncated body: Nest's multer mapping does not keep
// the error codes that would tell the cases apart (F-03).
export const PHOTO_ONLY =
  'Formulaire invalide : envoyez une seule photo, dans le champ « photo », sans autre champ';

/** The account has no photo (or its file is missing on the server). */
export function noIdPhoto(): NotFoundException {
  return new NotFoundException('Aucune photo d’identité pour ce compte');
}

/** A French 400 with the reason under `details` (field `photo`). */
export function invalidPhoto(reason: string): BadRequestException {
  return invalidFields([{ field: 'photo', errors: [reason] }]);
}
