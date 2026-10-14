import { ForbiddenException } from '@nestjs/common';

/** An active member of the store, but without a role this route allows. */
export function storeRoleRequired(): ForbiddenException {
  return new ForbiddenException({
    message:
      'Vous ne disposez pas de toutes les permissions pour effectuer cette action dans cette quincaillerie',
    error: 'STORE_ROLE_REQUIRED',
  });
}
