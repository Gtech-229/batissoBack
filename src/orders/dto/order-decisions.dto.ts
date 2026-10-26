import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, Length, ValidateIf } from 'class-validator';
import { Trim } from '../../common/validation/trim.js';

const REFUSAL_MESSAGE = 'Le motif du refus doit contenir 1 à 500 caractères';
const CANCELLATION_MESSAGE =
  'Le motif de l’annulation doit contenir 1 à 500 caractères';

export class RefuseOrderDto {
  // The customer sees the reason too, in their orders (user decision, 2026-10-26).
  @ApiProperty({
    description:
      'Pourquoi le gérant refuse le bon : visible par le vendeur et par le client, dans ses bons',
    example: 'Quantité trop importante pour ce client',
  })
  @Trim()
  @IsString({ message: REFUSAL_MESSAGE })
  @Length(1, 500, { message: REFUSAL_MESSAGE })
  reason: string;
}

export class CancelOrderDto {
  @ApiPropertyOptional({
    description: 'Pourquoi le bon est annulé (facultatif)',
    example: 'Le client a changé d’avis au comptoir',
  })
  // Omitted means no reason; null is refused, as elsewhere.
  @ValidateIf((_object, value) => value !== undefined)
  @Trim()
  @IsString({ message: CANCELLATION_MESSAGE })
  @Length(1, 500, { message: CANCELLATION_MESSAGE })
  reason?: string;
}
