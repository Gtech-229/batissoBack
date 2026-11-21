import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsUUID } from 'class-validator';
import { StatusReasonRule } from './status-reason.dto.js';

/** At most this many stores per group action (26b). */
export const MAX_BULK_STORES = 100;

const IDS_MESSAGE = `Choisissez de 1 à ${MAX_BULK_STORES} quincailleries`;

/** Body of bulk verify and reactivate. */
export class BulkStoreIdsDto {
  @ApiProperty({
    description: `Identifiants des quincailleries (1 à ${MAX_BULK_STORES} ; un identifiant en double n’est traité qu’une fois)`,
    type: [String],
    format: 'uuid',
    example: ['0192f0a4-7b1c-7c3e-9d2a-5e6f7a8b9c0d'],
  })
  @IsArray({ message: IDS_MESSAGE })
  @ArrayMinSize(1, { message: IDS_MESSAGE })
  @ArrayMaxSize(MAX_BULK_STORES, { message: IDS_MESSAGE })
  @IsUUID('all', {
    each: true,
    message: 'Chaque identifiant de quincaillerie doit être un UUID',
  })
  ids: string[];
}

/**
 * Body of bulk suspend and close: the ids and the reason, with the very rule
 * and messages as StatusReasonDto (StatusReasonRule).
 */
export class BulkStatusReasonDto extends BulkStoreIdsDto {
  @ApiProperty({
    description:
      'Motif, conservé avec le changement de statut de chaque quincaillerie (3 à 500 caractères)',
    example: 'Registre du commerce expiré',
  })
  @StatusReasonRule()
  reason: string;
}

export class BulkStatusError {
  @ApiProperty({
    description:
      'Code d’erreur de l’action seule : INVALID_STATUS_TRANSITION, STORE_DOCUMENTS_MISSING, NOT_FOUND',
    example: 'INVALID_STATUS_TRANSITION',
  })
  code: string;

  @ApiProperty({
    description: 'Message en français, le même que pour l’action seule',
    example: 'Impossible de vérifier une quincaillerie vérifiée',
  })
  message: string;
}

export class BulkStatusResultItem {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({
    description: 'L’action a été appliquée à cette quincaillerie',
  })
  ok: boolean;

  @ApiPropertyOptional({
    type: BulkStatusError,
    description: 'Pourquoi elle a été refusée (ok false)',
  })
  error?: BulkStatusError;
}

export class BulkStatusResult {
  @ApiProperty({
    type: [BulkStatusResultItem],
    description: 'Un résultat par quincaillerie, dans l’ordre envoyé',
  })
  results: BulkStatusResultItem[];
}
