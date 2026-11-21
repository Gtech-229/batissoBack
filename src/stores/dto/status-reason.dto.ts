import { applyDecorators } from '@nestjs/common';
import { ApiProperty } from '@nestjs/swagger';
import { IsString, Length } from 'class-validator';
import { Trim } from '../../common/validation/trim.js';

/**
 * The reason rule of suspend and close, shared by the single routes and the
 * group actions (26b): trimmed, 3 to 500 characters.
 */
export const StatusReasonRule = () =>
  applyDecorators(
    Trim(),
    IsString({ message: 'Le motif est requis' }),
    Length(3, 500, { message: 'Le motif doit contenir 3 à 500 caractères' }),
  );

/** Body of `suspend` and `close`: why the store's status changes. */
export class StatusReasonDto {
  @ApiProperty({
    description:
      'Motif, conservé avec le changement de statut (3 à 500 caractères)',
    example: 'Registre du commerce expiré',
  })
  @StatusReasonRule()
  reason: string;
}
