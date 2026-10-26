import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsInt,
  IsObject,
  IsUUID,
  Max,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { TrimLowerCase } from '../../common/validation/trim.js';

export const MAX_ORDER_LINES = 50;
export const MAX_LINE_QUANTITY = 1_000_000;

const LINES_MESSAGE = `Un bon contient de 1 à ${MAX_ORDER_LINES} lignes`;
const LINE_MESSAGE = 'Chaque ligne est un objet { articleId, quantity }';
const QUANTITY_MESSAGE = `La quantité doit être un nombre entier de 1 à ${MAX_LINE_QUANTITY.toLocaleString('fr-FR')}`;

export class OrderLineInput {
  @ApiProperty({
    description: 'Article en vente de la quincaillerie',
    example: '0192f0a4-7b1c-7c3e-9d2a-5e6f7a8b9c0d',
  })
  @TrimLowerCase()
  @IsUUID('all', { message: 'Identifiant d’article invalide' })
  articleId: string;

  @ApiProperty({
    description: 'Nombre d’unités (sacs, barres...), entier',
    example: 10,
  })
  @IsInt({ message: QUANTITY_MESSAGE })
  @Min(1, { message: QUANTITY_MESSAGE })
  @Max(MAX_LINE_QUANTITY, { message: QUANTITY_MESSAGE })
  quantity: number;
}

export class PrepareOrderDto {
  @ApiPropertyOptional({
    description:
      'Objectif du compte payé en premier (le reste vient de « Non affecté ») ; par défaut « Non affecté »',
    example: '0192f0a4-7b1c-7c3e-9d2a-5e6f7a8b9c0d',
  })
  // Omitted means Unassigned; null is refused, as on goal creation.
  @ValidateIf((_object, value) => value !== undefined)
  @TrimLowerCase()
  @IsUUID('all', { message: 'Identifiant d’objectif invalide' })
  goalId?: string;

  @ApiProperty({
    description: `Lignes du bon : chaque article au plus une fois, de 1 à ${MAX_ORDER_LINES} lignes. Le prix du jour de chaque article est figé sur sa ligne.`,
    type: [OrderLineInput],
  })
  @IsArray({ message: LINES_MESSAGE })
  @ArrayMinSize(1, { message: LINES_MESSAGE })
  @ArrayMaxSize(MAX_ORDER_LINES, { message: LINES_MESSAGE })
  @IsObject({ each: true, message: LINE_MESSAGE })
  @ValidateNested({ each: true, message: LINE_MESSAGE })
  @Type(() => OrderLineInput)
  lines: OrderLineInput[];
}
