import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsIn, IsString, Length } from 'class-validator';
import {
  IsPassword,
  PASSWORD_RULE_MESSAGE,
} from '../../common/validation/password.js';
import { TrimLowerCase } from '../../common/validation/trim.js';
import {
  PASSWORD_LINK_MODES,
  type PasswordLinkMode,
} from '../password-link.js';

export class PasswordLinkQuery {
  @ApiProperty({
    description:
      '`set` pour un premier mot de passe (compte qui n’en a pas encore), `reset` pour un mot de passe oublié',
    enum: PASSWORD_LINK_MODES,
  })
  @IsIn(PASSWORD_LINK_MODES, { message: 'Le mode doit être set ou reset' })
  mode: PasswordLinkMode;
}

export class ForgotPasswordDto {
  @ApiProperty({
    description: 'Adresse email de l’administrateur (insensible à la casse)',
    example: 'awa@batisso.com',
  })
  @TrimLowerCase()
  @IsEmail({}, { message: 'L’adresse email est invalide' })
  email: string;
}

export class ResetPasswordDto {
  @ApiProperty({
    description: 'Le jeton reçu dans le lien (`token` de l’URL)',
    example: '<jeton-du-lien>',
  })
  @IsString({ message: 'Le jeton est requis' })
  @Length(1, 200, { message: 'Le jeton est invalide' })
  token: string;

  @ApiProperty({
    description: `Le nouveau mot de passe. ${PASSWORD_RULE_MESSAGE}.`,
    example: '<votre-mot-de-passe>',
  })
  @IsPassword()
  password: string;
}

export class PasswordLinkRequested {
  @ApiProperty({
    description: 'Toujours le même message, que l’email ait un compte ou non',
    example:
      'Si un compte correspond à cet email, un lien vient de lui être envoyé.',
  })
  message: string;
}
