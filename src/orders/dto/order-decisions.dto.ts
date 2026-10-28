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

/** The customer refuses an order awaiting them (10b), with an optional reason. */
export class CustomerRefusalDto {
  @ApiPropertyOptional({
    description:
      'Pourquoi vous refusez ce bon (facultatif, transmis au gérant)',
    example: 'Je n’ai pas demandé ces articles',
  })
  @ValidateIf((_object, value) => value !== undefined)
  @Trim()
  @IsString({ message: REFUSAL_MESSAGE })
  @Length(1, 500, { message: REFUSAL_MESSAGE })
  reason?: string;
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

const PAID_CANCELLATION_MESSAGE =
  'Le motif de l’annulation doit contenir 1 à 500 caractères';

/**
 * The manager cancels a paid order (11b): the reason is required (user
 * decision, 2026-10-28), shown to the customer and sent in the SMS.
 */
export class CancelPaidOrderDto {
  @ApiProperty({
    description:
      'Pourquoi le bon payé est annulé : visible par le client, dans ses bons, son historique et le SMS',
    example: 'Rupture de stock : livraison impossible',
  })
  @Trim()
  @IsString({ message: PAID_CANCELLATION_MESSAGE })
  @Length(1, 500, { message: PAID_CANCELLATION_MESSAGE })
  reason: string;
}
