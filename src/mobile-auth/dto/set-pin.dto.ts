import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, Length } from 'class-validator';
import { Trim } from '../../common/validation/trim.js';
import { IsDevicePublicKey } from '../device-key.js';
import { IsPin } from '../pin.js';

export class SetPinDto {
  @ApiProperty({
    description: 'Jeton renvoyé par `POST /auth/code/verify`',
    example: 'kq3V0d5m3n2Y...',
  })
  @IsString({ message: 'Le jeton de vérification est requis' })
  @Length(1, 200, { message: 'Le jeton de vérification est invalide' })
  verificationToken: string;

  // @IsPin also applies when the PIN is checked: every PIN was chosen through
  // this rule, so a weak value cannot be a user's PIN and is refused early.
  @ApiProperty({
    description:
      'Première connexion : le PIN choisi (6 chiffres, sans chiffres tous identiques ni suite). Sinon : le PIN actuel.',
    example: '482915',
  })
  @IsPin()
  pin: string;

  @ApiProperty({
    description:
      'Clé publique de la paire créée par l’application dans le stockage sécurisé du téléphone (Android Keystore, Secure Enclave) : EC P-256, format SPKI DER, en base64. La clé privée ne quitte jamais le téléphone.',
    example: 'MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAE...',
  })
  @IsDevicePublicKey()
  publicKey: string;

  @ApiPropertyOptional({
    description:
      'Nom de l’appareil affiché à l’utilisateur (100 caractères au plus)',
    example: 'Samsung A15',
  })
  @IsOptional()
  @Trim()
  @IsString({ message: 'Le nom de l’appareil doit être un texte' })
  @Length(1, 100, {
    message: 'Le nom de l’appareil doit contenir 1 à 100 caractères',
  })
  deviceName?: string;
}
