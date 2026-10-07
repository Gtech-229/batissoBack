import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsString, Length } from 'class-validator';

/** Body of `suspend` and `close`: why the store's status changes. */
export class StatusReasonDto {
  @ApiProperty({
    description:
      'Motif, conservé avec le changement de statut (3 à 500 caractères)',
    example: 'Registre du commerce expiré',
  })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString({ message: 'Le motif est requis' })
  @Length(3, 500, { message: 'Le motif doit contenir 3 à 500 caractères' })
  reason: string;
}
