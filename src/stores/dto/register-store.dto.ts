import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsDefined,
  IsISO31661Alpha2,
  IsOptional,
  IsString,
  Length,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { AMOUNT_RULE_MESSAGE, IsAmount } from '../../common/money.js';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

// Phone numbers are checked against the store's country in the service, since
// the rule depends on another field (countryCode).
const PHONE_DESCRIPTION =
  'Numéro du pays de la quincaillerie, au format local (76 00 00 00) ou international (+223 76 00 00 00)';

export class StoreSettingsInput {
  @ApiProperty({
    description: `Solde maximal par client, en plus petite unité de la devise. ${AMOUNT_RULE_MESSAGE}.`,
    example: '2000000',
  })
  @IsAmount()
  maxBalance: string;

  @ApiProperty({
    description:
      'Montant au-delà duquel un bon de sortie doit être validé par le gérant',
    example: '200000',
  })
  @IsAmount()
  validationThreshold: string;

  @ApiProperty({
    description: 'Dépôt minimum (au plus égal au solde maximal)',
    example: '500',
  })
  @IsAmount()
  minDeposit: string;

  @ApiPropertyOptional({
    description: 'Conditions générales de la quincaillerie, montrées au client',
  })
  @IsOptional()
  @Transform(trim)
  @IsString({ message: 'Les conditions générales doivent être un texte' })
  @MaxLength(10000, {
    message: 'Les conditions générales dépassent 10 000 caractères',
  })
  terms?: string;
}

export class StoreManagerInput {
  @ApiProperty({ description: 'Prénom du gérant', example: 'Awa' })
  @Transform(trim)
  @IsString({ message: 'Le prénom est requis' })
  @Length(1, 100, { message: 'Le prénom doit contenir 1 à 100 caractères' })
  firstName: string;

  @ApiProperty({ description: 'Nom du gérant', example: 'Diallo' })
  @Transform(trim)
  @IsString({ message: 'Le nom est requis' })
  @Length(1, 100, { message: 'Le nom doit contenir 1 à 100 caractères' })
  lastName: string;

  @ApiProperty({ description: PHONE_DESCRIPTION, example: '76 00 00 00' })
  @IsString({ message: 'Le numéro de téléphone est requis' })
  @Length(2, 30, { message: 'Le numéro de téléphone est invalide' })
  phone: string;
}

export class RegisterStoreDto {
  @ApiProperty({
    description: 'Code du pays (actif) de la quincaillerie',
    example: 'ML',
  })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toUpperCase() : value,
  )
  @IsISO31661Alpha2({
    message: 'Le code pays doit être un code ISO à 2 lettres (ex. ML)',
  })
  countryCode: string;

  @ApiProperty({
    description: 'Nom de la quincaillerie',
    example: 'Quincaillerie du Carrefour',
  })
  @Transform(trim)
  @IsString({ message: 'Le nom est requis' })
  @Length(1, 150, { message: 'Le nom doit contenir 1 à 150 caractères' })
  name: string;

  @ApiProperty({ description: 'Adresse', example: 'Rue 12, Hippodrome' })
  @Transform(trim)
  @IsString({ message: 'L’adresse est requise' })
  @Length(1, 300, { message: 'L’adresse doit contenir 1 à 300 caractères' })
  address: string;

  @ApiProperty({ description: 'Ville', example: 'Bamako' })
  @Transform(trim)
  @IsString({ message: 'La ville est requise' })
  @Length(1, 100, { message: 'La ville doit contenir 1 à 100 caractères' })
  city: string;

  @ApiProperty({ description: PHONE_DESCRIPTION, example: '20 22 00 00' })
  @IsString({ message: 'Le numéro de téléphone est requis' })
  @Length(2, 30, { message: 'Le numéro de téléphone est invalide' })
  phone: string;

  @ApiProperty({
    description:
      'Numéro du registre du commerce (vérifié par l’administrateur)',
    example: 'MA.BKO.2026.B.1234',
  })
  @Transform(trim)
  @IsString({ message: 'Le numéro du registre du commerce est requis' })
  @Length(1, 100, {
    message: 'Le registre du commerce doit contenir 1 à 100 caractères',
  })
  tradeRegister: string;

  @ApiProperty({ description: 'Règles d’argent de la quincaillerie' })
  @IsDefined({ message: 'Les paramètres de la quincaillerie sont requis' })
  // @Type turns the plain JSON object into a StoreSettingsInput instance, so
  // @ValidateNested can run the validators declared on that class.
  @ValidateNested()
  @Type(() => StoreSettingsInput)
  settings: StoreSettingsInput;

  @ApiProperty({ description: 'Premier gérant de la quincaillerie' })
  @IsDefined({ message: 'Le gérant est requis' })
  @ValidateNested()
  @Type(() => StoreManagerInput)
  manager: StoreManagerInput;
}
