import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsString,
  Matches,
  MaxLength,
  MinLength,
  ValidateIf,
} from 'class-validator';

/** Green API idInstance: digits only. */
export const INSTANCE_ID_PATTERN = /^\d{4,20}$/;
/** Green API apiTokenInstance: letters and digits only. */
export const TOKEN_PATTERN = /^[A-Za-z0-9]{20,128}$/;

export class WhatsappSettingsAdmin {
  @ApiProperty({ example: '0192f0a4-7b1c-7c3e-9d2a-5e6f7a8b9c0d' })
  id: string;

  @ApiProperty({ example: 'Awa' })
  firstName: string;

  @ApiProperty({ example: 'Diallo' })
  lastName: string;
}

/** The settings as the super admin reads them: never the token. */
export class WhatsappSettingsResponse {
  @ApiProperty({
    description:
      'Envoi des messages par WhatsApp activé (codes de connexion, codes d’achat, notifications)',
    example: false,
  })
  enabled: boolean;

  @ApiProperty({
    description: 'Identifiant de l’instance Green API (idInstance)',
    type: String,
    nullable: true,
    example: '7103123456',
  })
  instanceId: string | null;

  @ApiProperty({
    description: 'Un jeton est enregistré (il n’est jamais renvoyé)',
    example: true,
  })
  tokenConfigured: boolean;

  @ApiProperty({
    description: 'Les 4 derniers caractères du jeton enregistré',
    type: String,
    nullable: true,
    example: '2345',
  })
  tokenLast4: string | null;

  @ApiProperty({
    description:
      'Le jeton enregistré peut être déchiffré avec la clé actuelle du serveur ; sinon, saisissez-le à nouveau',
    example: true,
  })
  tokenReadable: boolean;

  @ApiProperty({
    description:
      'La clé de chiffrement du serveur est configurée : sans elle, aucun jeton ne peut être enregistré',
    example: true,
  })
  encryptionAvailable: boolean;

  @ApiProperty({
    type: String,
    nullable: true,
    example: '2026-11-16T09:00:00.000Z',
  })
  updatedAt: string | null;

  @ApiProperty({ type: WhatsappSettingsAdmin, nullable: true })
  updatedBy: WhatsappSettingsAdmin | null;
}

const PASSWORD_MESSAGE = 'Le mot de passe actuel est requis';
const INSTANCE_MESSAGE =
  'L’identifiant de l’instance doit contenir entre 4 et 20 chiffres';
const TOKEN_MESSAGE =
  'Le jeton doit contenir entre 20 et 128 lettres ou chiffres';

/**
 * A change, confirmed by the super admin's password. Omitted fields keep their
 * value; `ValidateIf` rather than `@IsOptional()`, so `null` is refused.
 */
export class UpdateWhatsappSettingsDto {
  @ApiProperty({
    description: 'Mot de passe actuel du super administrateur, pour confirmer',
    example: '<votre-mot-de-passe>',
  })
  @IsString({ message: PASSWORD_MESSAGE })
  @MinLength(1, { message: PASSWORD_MESSAGE })
  @MaxLength(128, { message: 'Le mot de passe actuel est trop long' })
  currentPassword: string;

  @ApiPropertyOptional({
    description:
      'Activer ou désactiver l’envoi par WhatsApp ; l’activer demande un identifiant et un jeton lisible',
    example: true,
  })
  @ValidateIf((_object, value) => value !== undefined)
  @IsBoolean({ message: 'enabled doit valoir true ou false' })
  enabled?: boolean;

  @ApiPropertyOptional({
    description:
      'Identifiant de l’instance Green API (idInstance), 4 à 20 chiffres',
    example: '7103123456',
  })
  @ValidateIf((_object, value) => value !== undefined)
  @IsString({ message: INSTANCE_MESSAGE })
  @Matches(INSTANCE_ID_PATTERN, { message: INSTANCE_MESSAGE })
  instanceId?: string;

  @ApiPropertyOptional({
    description:
      'Jeton de l’instance Green API (apiTokenInstance), 20 à 128 lettres ou chiffres ; chiffré, jamais renvoyé',
    example: '<jeton>',
  })
  @ValidateIf((_object, value) => value !== undefined)
  @IsString({ message: TOKEN_MESSAGE })
  @Matches(TOKEN_PATTERN, { message: TOKEN_MESSAGE })
  token?: string;
}

/** One saved change, as the history lists it: never the token. */
export class WhatsappSettingsChangeView {
  @ApiProperty({ example: '0192f0a4-7b1c-7c3e-9d2a-5e6f7a8b9c0d' })
  id: string;

  @ApiProperty({ example: '2026-11-16T09:00:00.000Z' })
  changedAt: string;

  @ApiProperty({ type: WhatsappSettingsAdmin })
  changedBy: WhatsappSettingsAdmin;

  @ApiProperty({ example: false })
  enabledBefore: boolean;

  @ApiProperty({ example: true })
  enabledAfter: boolean;

  @ApiProperty({ type: String, nullable: true, example: null })
  instanceIdBefore: string | null;

  @ApiProperty({ type: String, nullable: true, example: '7103123456' })
  instanceIdAfter: string | null;

  @ApiProperty({
    description: 'Un nouveau jeton a été enregistré',
    example: true,
  })
  tokenChanged: boolean;

  @ApiProperty({
    description: 'Les 4 derniers caractères du jeton après la modification',
    type: String,
    nullable: true,
    example: '2345',
  })
  tokenLast4: string | null;
}
