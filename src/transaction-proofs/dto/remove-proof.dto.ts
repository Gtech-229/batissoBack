import { ApiProperty } from '@nestjs/swagger';
import { IsString, Length } from 'class-validator';
import { Trim } from '../../common/validation/trim.js';

const REASON_MESSAGE = 'Le motif doit contenir 3 à 500 caractères';

export class RemoveProofDto {
  @ApiProperty({
    description: 'Pourquoi cette preuve est retirée (3 à 500 caractères)',
    example: 'Photo du reçu d’un autre client',
  })
  @Trim()
  @IsString({ message: REASON_MESSAGE })
  @Length(3, 500, { message: REASON_MESSAGE })
  reason: string;
}
