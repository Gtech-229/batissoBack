import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, Length, ValidateIf } from 'class-validator';
import { IsCountedAmount } from '../../common/money.js';
import { Trim } from '../../common/validation/trim.js';

const JUSTIFICATION_RULE = 'La justification doit contenir 1 à 500 caractères';

export class CloseCashDto {
  // Whether a justification is needed depends on the expected total, computed
  // in the service under the store lock.
  @ApiProperty({
    description:
      'Espèces comptées dans la caisse, en unités de la devise, en texte (entier positif ou nul, sans décimales)',
    example: '48500',
  })
  @IsCountedAmount()
  countedTotal: string;

  @ApiPropertyOptional({
    description:
      'Pourquoi le montant compté diffère du montant attendu : requise dès qu’il y a un écart',
    example: 'Monnaie rendue en trop à un client',
  })
  // Omitted means none; null is refused, as elsewhere.
  @ValidateIf((_object, value) => value !== undefined)
  @Trim()
  @IsString({ message: JUSTIFICATION_RULE })
  @Length(1, 500, { message: JUSTIFICATION_RULE })
  justification?: string;
}
