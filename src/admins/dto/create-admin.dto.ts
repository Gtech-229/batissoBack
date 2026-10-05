import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsEmail, IsString, Length } from 'class-validator';
import {
  IsPassword,
  PASSWORD_RULE_MESSAGE,
} from '../../common/validation/password.js';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

export class CreateAdminDto {
  @ApiProperty({
    description: 'Adresse email (enregistrée en minuscules)',
    example: 'awa@batisso.com',
  })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  @IsEmail({}, { message: 'L’adresse email est invalide' })
  email: string;

  @ApiProperty({ description: 'Prénom', example: 'Awa' })
  @Transform(trim)
  @IsString({ message: 'Le prénom est requis' })
  @Length(1, 100, { message: 'Le prénom doit contenir 1 à 100 caractères' })
  firstName: string;

  @ApiProperty({ description: 'Nom', example: 'Diallo' })
  @Transform(trim)
  @IsString({ message: 'Le nom est requis' })
  @Length(1, 100, { message: 'Le nom doit contenir 1 à 100 caractères' })
  lastName: string;

  @ApiProperty({
    description: `Mot de passe initial, à transmettre à l’administrateur : il devra le changer à sa première connexion. ${PASSWORD_RULE_MESSAGE}.`,
    example: 'Initial#2026',
  })
  @IsPassword()
  password: string;
}
