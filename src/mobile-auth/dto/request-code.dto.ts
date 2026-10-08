import { ApiProperty } from '@nestjs/swagger';
import { IsString, Length, Matches } from 'class-validator';
import { CODE_LENGTH } from '../mobile-auth.constants.js';
import { Trim } from '../../common/validation/trim.js';

// The number itself is checked against the active country in the service.
const PHONE_DESCRIPTION =
  'Numéro du pays actif, au format local (76 00 00 00) ou international (+223 76 00 00 00)';

export class RequestCodeDto {
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
