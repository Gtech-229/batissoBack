import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsString, IsUUID, Length } from 'class-validator';
import { Trim, TrimLowerCase } from '../../common/validation/trim.js';

export class CreateAdminDto {
  @ApiProperty({
    description: 'Adresse email (enregistrée en minuscules)',
    example: 'awa@batisso.com',
  })
  @TrimLowerCase()
  @IsEmail({}, { message: 'L’adresse email est invalide' })
  email: string;

  @ApiProperty({ description: 'Prénom', example: 'Awa' })
  @Trim()
  @IsString({ message: 'Le prénom est requis' })
  @Length(1, 100, { message: 'Le prénom doit contenir 1 à 100 caractères' })
  firstName: string;

  @ApiProperty({ description: 'Nom', example: 'Diallo' })
  @Trim()
  @IsString({ message: 'Le nom est requis' })
  @Length(1, 100, { message: 'Le nom doit contenir 1 à 100 caractères' })
  lastName: string;

  @ApiProperty({
    description:
      'Identifiant du rôle donné à l’administrateur (voir `GET /admin/roles`)',
    example: '0192f0a4-7b1c-7c3e-9d2a-5e6f7a8b9c0d',
  })
  @IsUUID(undefined, { message: 'Identifiant de rôle invalide' })
  roleId: string;
}
