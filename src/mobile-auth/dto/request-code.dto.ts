import { ApiProperty } from '@nestjs/swagger';
import { IsISO31661Alpha2, IsString, Length, Matches } from 'class-validator';
import { CODE_LENGTH } from '../mobile-auth.constants.js';
import { Trim, TrimUpperCase } from '../../common/validation/trim.js';

// The number itself is checked against countryCode in the service (27).
const PHONE_DESCRIPTION =
  'Numéro du pays choisi (countryCode), au format local (76 00 00 00) ou international (+223 76 00 00 00)';

export class RequestCodeDto {
  @ApiProperty({
    description:
      'Code du pays du numéro, choisi dans GET /countries (pays ouverts)',
    example: 'ML',
  })
  @TrimUpperCase()
  @IsISO31661Alpha2({
    message: 'Le code pays doit être un code ISO à 2 lettres (ex. ML)',
  })
  countryCode: string;

  @ApiProperty({ description: PHONE_DESCRIPTION, example: '76 00 00 00' })
  @Trim()
  @IsString({ message: 'Le numéro de téléphone est requis' })
  @Length(1, 30, { message: 'Le numéro de téléphone est invalide' })
  phone: string;
}

export class VerifyCodeDto extends RequestCodeDto {
  @ApiProperty({
    description: 'Code à 6 chiffres reçu par SMS',
    example: '482915',
  })
  @Trim()
  @IsString({ message: 'Le code doit contenir 6 chiffres' })
  @Matches(new RegExp(`^[0-9]{${CODE_LENGTH}}$`), {
    message: 'Le code doit contenir 6 chiffres',
  })
  code: string;

  @ApiProperty({
    description:
      'Identifiant de l’installation, créé une fois par l’application et gardé dans son stockage sécurisé (8 à 100 caractères : lettres, chiffres, `.`, `_`, `-`)',
    example: '6f1c2a90-3b4d-4e8f-9a1b-2c3d4e5f6a7b',
  })
  @IsString({ message: 'L’identifiant de l’appareil est requis' })
  @Matches(/^[A-Za-z0-9._-]{8,100}$/, {
    message:
      'L’identifiant de l’appareil doit contenir 8 à 100 caractères : lettres, chiffres, point, tiret ou souligné',
  })
  deviceId: string;
}
