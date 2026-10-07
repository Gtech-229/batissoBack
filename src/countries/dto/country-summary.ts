import { ApiProperty } from '@nestjs/swagger';
import type { Country } from '../../generated/prisma/client.js';

export class CountrySummary {
  @ApiProperty({ description: 'Code ISO 3166-1 du pays', example: 'ML' })
  code: string;

  @ApiProperty({ description: 'Nom du pays', example: 'Mali' })
  name: string;

  @ApiProperty({
    description: 'Indicatif téléphonique, déduit du code pays',
    example: '+223',
  })
  phonePrefix: string;

  @ApiProperty({ description: 'Code devise ISO 4217', example: 'XOF' })
  currencyCode: string;

  @ApiProperty({
    description: 'Symbole affiché de la devise',
    example: 'F CFA',
  })
  currencySymbol: string;

  @ApiProperty({
    description: 'Chiffres après la virgule dans les montants',
    example: 0,
  })
  decimals: number;

  @ApiProperty({ description: 'Langue par défaut', example: 'fr' })
  language: string;

  @ApiProperty({
    description: 'Vrai pour le pays actif (un seul en V1)',
    example: true,
  })
  active: boolean;
}

export function toCountrySummary(country: Country): CountrySummary {
  return {
    code: country.code,
    name: country.name,
    phonePrefix: country.phonePrefix,
    currencyCode: country.currencyCode,
    currencySymbol: country.currencySymbol,
    decimals: country.decimals,
    language: country.language,
    active: country.active,
  };
}
