import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsISO31661Alpha2,
  IsObject,
  IsOptional,
  IsString,
  Length,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { AMOUNT_RULE_MESSAGE, IsAmount } from '../../common/money.js';
import { Trim, TrimUpperCase } from '../../common/validation/trim.js';

// Phone numbers are checked against the store's country in the service, since
// the rule depends on another field (countryCode).
const PHONE_DESCRIPTION =
  'Numéro du pays de la quincaillerie, au format local (76 00 00 00) ou international (+223 76 00 00 00)';

// One message per nested object, shared by @IsObject (missing, null, array,
// text, number) and @ValidateNested (its own English check on non-objects).
const SETTINGS_MESSAGE =
  'Les paramètres de la quincaillerie sont requis, sous forme d’objet';
const MANAGER_MESSAGE = 'Le gérant est requis, sous forme d’objet';

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
  @Trim()
  @IsString({ message: 'Les conditions générales doivent être un texte' })
  @MaxLength(10000, {
    message: 'Les conditions générales dépassent 10 000 caractères',
  })
  terms?: string;
}

export class StoreManagerInput {
  @ApiProperty({ description: 'Prénom du gérant', example: 'Awa' })
  @Trim()
  @IsString({ message: 'Le prénom est requis' })
  @Length(1, 100, { message: 'Le prénom doit contenir 1 à 100 caractères' })
  firstName: string;

  @ApiProperty({ description: 'Nom du gérant', example: 'Diallo' })
  @Trim()
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
  @TrimUpperCase()
  @IsISO31661Alpha2({
    message: 'Le code pays doit être un code ISO à 2 lettres (ex. ML)',
  })
  countryCode: string;

  @ApiProperty({
    description: 'Nom de la quincaillerie',
    example: 'Quincaillerie du Carrefour',
  })
  @Trim()
  @IsString({ message: 'Le nom est requis' })
  @Length(1, 150, { message: 'Le nom doit contenir 1 à 150 caractères' })
  name: string;

  @ApiProperty({ description: 'Adresse', example: 'Rue 12, Hippodrome' })
  @Trim()
  @IsString({ message: 'L’adresse est requise' })
  @Length(1, 300, { message: 'L’adresse doit contenir 1 à 300 caractères' })
  address: string;

  @ApiProperty({ description: 'Ville', example: 'Bamako' })
  @Trim()
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
  @Trim()
  @IsString({ message: 'Le numéro du registre du commerce est requis' })
  @Length(1, 100, {
    message: 'Le registre du commerce doit contenir 1 à 100 caractères',
  })
  tradeRegister: string;

  @ApiProperty({ description: 'Règles d’argent de la quincaillerie' })
  // @IsObject, not @IsDefined: @ValidateNested accepts an array and validates
  // each element, so `settings: []` would pass and break the service.
  @IsObject({ message: SETTINGS_MESSAGE })
  // @Type turns the plain JSON object into a StoreSettingsInput instance, so
  // @ValidateNested can run the validators declared on that class.
  @ValidateNested({ message: SETTINGS_MESSAGE })
  @Type(() => StoreSettingsInput)
  settings: StoreSettingsInput;

  @ApiProperty({ description: 'Premier gérant de la quincaillerie' })
  @IsObject({ message: MANAGER_MESSAGE })
  @ValidateNested({ message: MANAGER_MESSAGE })
  @Type(() => StoreManagerInput)
  manager: StoreManagerInput;
}
