import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsIn,
  IsInt,
  IsISO31661Alpha2,
  IsISO4217CurrencyCode,
  IsString,
  Length,
  Max,
  Min,
  ValidateIf,
} from 'class-validator';
import { Trim, TrimUpperCase } from '../../common/validation/trim.js';

export const COUNTRY_LANGUAGES = ['fr', 'en'] as const;

export class CreateCountryDto {
  @ApiProperty({
    description: 'Code ISO 3166-1 à 2 lettres (insensible à la casse)',
    example: 'ML',
  })
  @TrimUpperCase()
  @IsISO31661Alpha2({
    message: 'Le code pays doit être un code ISO à 2 lettres (ex. ML)',
  })
  code: string;

  @ApiProperty({ description: 'Nom du pays', example: 'Mali' })
  @Trim()
  @IsString({ message: 'Le nom du pays est requis' })
  @Length(1, 100, {
    message: 'Le nom du pays doit contenir 1 à 100 caractères',
  })
  name: string;

  @ApiProperty({
    description: 'Code devise ISO 4217 (montants de tout le pays)',
    example: 'XOF',
  })
  @TrimUpperCase()
  @IsISO4217CurrencyCode({
    message: 'Le code devise doit être un code ISO 4217 valide (ex. XOF)',
  })
  currencyCode: string;

  @ApiProperty({
    description: 'Symbole affiché de la devise',
    example: 'F CFA',
  })
  @Trim()
  @IsString({ message: 'Le symbole de la devise est requis' })
  @Length(1, 10, {
    message: 'Le symbole de la devise doit contenir 1 à 10 caractères',
  })
  currencySymbol: string;

  @ApiProperty({
    description: 'Chiffres après la virgule dans les montants (XOF : 0)',
    example: 0,
    minimum: 0,
    maximum: 3,
  })
  @IsInt({ message: 'Le nombre de décimales doit être un entier entre 0 et 3' })
  @Min(0, {
    message: 'Le nombre de décimales doit être un entier entre 0 et 3',
  })
  @Max(3, {
    message: 'Le nombre de décimales doit être un entier entre 0 et 3',
  })
  decimals: number;

  @ApiPropertyOptional({
    description: 'Langue par défaut',
    enum: COUNTRY_LANGUAGES,
    default: 'fr',
  })
  // Optional when omitted (the database defaults to fr), but null is refused:
  // @IsOptional() would let null through to a non-null column.
  @ValidateIf((_object, value) => value !== undefined)
  @IsIn(COUNTRY_LANGUAGES, { message: 'La langue doit être fr ou en' })
  language?: string;
}
