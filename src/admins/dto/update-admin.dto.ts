import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEmail, IsString, Length, ValidateIf } from 'class-validator';
import { Trim, TrimLowerCase } from '../../common/validation/trim.js';

// Not @IsOptional(): it lets null through to Prisma, a 500 (F-38).
const sent = (_: object, value: unknown) => value !== undefined;

/** Corrects an admin's details; only the fields sent change. */
export class UpdateAdminDto {
  @ApiPropertyOptional({
    description:
      'Nouvelle adresse email (enregistrée en minuscules). Les liens de mot de passe non utilisés ne valent plus : l’administrateur en demande un nouveau.',
    example: 'awa@batisso.com',
  })
  @ValidateIf(sent)
  @TrimLowerCase()
  @IsEmail({}, { message: 'L’adresse email est invalide' })
  email?: string;

  @ApiPropertyOptional({ description: 'Prénom', example: 'Awa' })
  @ValidateIf(sent)
  @Trim()
  @IsString({ message: 'Le prénom est requis' })
  @Length(1, 100, { message: 'Le prénom doit contenir 1 à 100 caractères' })
  firstName?: string;

  @ApiPropertyOptional({ description: 'Nom', example: 'Diallo' })
  @ValidateIf(sent)
  @Trim()
  @IsString({ message: 'Le nom est requis' })
  @Length(1, 100, { message: 'Le nom doit contenir 1 à 100 caractères' })
  lastName?: string;
}
