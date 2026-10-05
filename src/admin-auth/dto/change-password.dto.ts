import { ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength, MinLength } from 'class-validator';
import {
  IsPassword,
  PASSWORD_RULE_MESSAGE,
} from '../../common/validation/password.js';

export class ChangePasswordDto {
  @ApiProperty({
    description: 'Mot de passe actuel',
    example: 'Change#Me2026',
  })
  @IsString({ message: 'Le mot de passe actuel est requis' })
  @MinLength(1, { message: 'Le mot de passe actuel est requis' })
  @MaxLength(128, { message: 'Le mot de passe actuel est trop long' })
  currentPassword: string;

  @ApiProperty({ description: PASSWORD_RULE_MESSAGE, example: 'Nouveau#2026' })
  @IsPassword()
  newPassword: string;
}
