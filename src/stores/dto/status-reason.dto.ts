import { ApiProperty } from '@nestjs/swagger';
import { IsString, Length } from 'class-validator';
import { Trim } from '../../common/validation/trim.js';

/** Body of `suspend` and `close`: why the store's status changes. */
export class StatusReasonDto {
  @ApiProperty({
    description:
      'Motif, conservé avec le changement de statut (3 à 500 caractères)',
    example: 'Registre du commerce expiré',
  })
  @Trim()
  @IsString({ message: 'Le motif est requis' })
  @Length(3, 500, { message: 'Le motif doit contenir 3 à 500 caractères' })
  reason: string;
}
