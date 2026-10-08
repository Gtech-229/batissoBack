import { ApiProperty, PickType } from '@nestjs/swagger';
import { IsString, Length, Matches } from 'class-validator';
import { VerifyCodeDto } from './request-code.dto.js';

const PIN_FORMAT_MESSAGE = 'Le code PIN doit contenir 6 chiffres';

/** `POST /auth/challenge`: phone and deviceId, same rules as the SMS code step. */
export class ChallengeDto extends PickType(VerifyCodeDto, [
  'phone',
  'deviceId',
] as const) {}

export class ChallengeResponse {
  @ApiProperty({
    description:
      'Valeur à signer avec la clé privée de l’appareil (ECDSA P-256 / SHA-256, sur ses octets UTF-8), puis à renvoyer à `POST /auth/login`. Usage unique.',
    example: 'dBxN0m4q6Hk0bW2y...',
  })
  challenge: string;

  @ApiProperty({ description: 'Durée de validité, en secondes', example: 120 })
  expiresIn: number;
}

export class MobileLoginDto extends ChallengeDto {
  // Format only, not @IsPin: the strength rule applies when a PIN is chosen.
  @ApiProperty({ description: 'Code PIN à 6 chiffres', example: '482915' })
  @IsString({ message: PIN_FORMAT_MESSAGE })
  @Matches(/^[0-9]{6}$/, { message: PIN_FORMAT_MESSAGE })
  pin: string;

  @ApiProperty({
    description: 'Valeur reçue de `POST /auth/challenge`',
    example: 'dBxN0m4q6Hk0bW2y...',
  })
  @IsString({ message: 'Le défi est requis' })
  @Length(1, 100, { message: 'Le défi est invalide' })
  challenge: string;

  @ApiProperty({
    description:
      'Signature du défi par la clé privée de l’appareil : ECDSA P-256 / SHA-256, format DER, en base64',
    example: 'MEUCIQDx...',
  })
  @IsString({ message: 'La signature est requise' })
  @Matches(/^[A-Za-z0-9+/]{1,200}={0,2}$/, {
    message: 'La signature doit être encodée en base64',
  })
  signature: string;
}
