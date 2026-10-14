import { ApiProperty } from '@nestjs/swagger';
import { IsString, Length } from 'class-validator';
import { Trim } from '../../common/validation/trim.js';

export class AddSellerDto {
  // The number itself is checked against the store's country in the service.
  @ApiProperty({
    description:
      'Numéro du vendeur, du pays de la quincaillerie, au format local (76 00 00 00) ou international (+223 76 00 00 00)',
    example: '76 11 22 33',
  })
  @Trim()
  @IsString({ message: 'Le numéro de téléphone est requis' })
  @Length(1, 30, { message: 'Le numéro de téléphone est invalide' })
  phone: string;

  @ApiProperty({
    description:
      'Prénom (gardé tel quel si ce numéro appartient déjà à un utilisateur)',
    example: 'Moussa',
  })
  @Trim()
  @IsString({ message: 'Le prénom est requis' })
  @Length(1, 100, { message: 'Le prénom doit contenir 1 à 100 caractères' })
  firstName: string;

  @ApiProperty({
    description:
      'Nom (gardé tel quel si ce numéro appartient déjà à un utilisateur)',
    example: 'Traoré',
  })
  @Trim()
  @IsString({ message: 'Le nom est requis' })
  @Length(1, 100, { message: 'Le nom doit contenir 1 à 100 caractères' })
  lastName: string;
}
