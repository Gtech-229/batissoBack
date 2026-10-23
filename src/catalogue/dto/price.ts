import { ApiProperty } from '@nestjs/swagger';
import { formatAmount, IsAmount } from '../../common/money.js';
import type { PriceHistory } from '../../generated/prisma/client.js';

export class ChangePriceDto {
  @ApiProperty({
    description: 'Nouveau prix du jour, en unités de la devise, en texte',
    example: '5500',
  })
  @IsAmount()
  price: string;
}

export class PriceHistoryEntry {
  @ApiProperty({
    description: 'Identifiant de l’entrée',
    example: '0192f0a4-7b1c-7c3e-9d2a-5e6f7a8b9c0d',
  })
  id: string;

  @ApiProperty({
    description: 'Prix, en unités de la devise, en texte',
    example: '5000',
  })
  price: string;

  @ApiProperty({
    description: 'Date à partir de laquelle ce prix s’applique',
    example: '2026-10-23T10:00:00.000Z',
  })
  startsAt: Date;
}

export function toPriceHistoryEntry(entry: PriceHistory): PriceHistoryEntry {
  return {
    id: entry.id,
    price: formatAmount(entry.price),
    startsAt: entry.startsAt,
  };
}
