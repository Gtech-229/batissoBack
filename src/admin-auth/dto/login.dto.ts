import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsString, MaxLength, MinLength } from 'class-validator';
import { TrimLowerCase } from '../../common/validation/trim.js';

export class LoginDto {
  @ApiProperty({
    description: 'Adresse email de l’administrateur (insensible à la casse)',
    example: 'admin@batisso.local',
  })
  @TrimLowerCase()
  @IsEmail({}, { message: 'L’adresse email est invalide' })
  email: string;

  // Only the length is checked here: the password rule applies when a password
  // is chosen, not at login. The maximum keeps huge inputs away from scrypt.
  @ApiProperty({ description: 'Mot de passe', example: 'Change#Me2026' })
  @IsString({ message: 'Le mot de passe est requis' })
  @MinLength(1, { message: 'Le mot de passe est requis' })
  @MaxLength(128, { message: 'Le mot de passe est trop long' })
  password: string;
}
