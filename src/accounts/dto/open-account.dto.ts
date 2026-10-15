import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  Equals,
  IsObject,
  IsOptional,
  IsString,
  Length,
  ValidateNested,
} from 'class-validator';
import { Trim } from '../../common/validation/trim.js';

// The numbers themselves are checked against the store's country in the service.
const PHONE_DESCRIPTION =
  'du pays de la quincaillerie, au format local (76 00 00 00) ou international (+223 76 00 00 00)';

// One message per nested object, shared by @IsObject and @ValidateNested (see
// RegisterStoreDto).
const CUSTOMER_MESSAGE = 'Le client est requis, sous forme d’objet';
const BENEFICIARY_MESSAGE = 'Le bénéficiaire doit être un objet';

export class CustomerInput {
  @ApiProperty({
    description: `Numéro du client, ${PHONE_DESCRIPTION}`,
    example: '76 44 55 66',
  })
  @Trim()
  @IsString({ message: 'Le numéro de téléphone est requis' })
  @Length(1, 30, { message: 'Le numéro de téléphone est invalide' })
  phone: string;

  @ApiProperty({
    description:
      'Prénom (gardé tel quel si ce numéro appartient déjà à un utilisateur)',
    example: 'Fanta',
  })
  @Trim()
  @IsString({ message: 'Le prénom est requis' })
  @Length(1, 100, { message: 'Le prénom doit contenir 1 à 100 caractères' })
  firstName: string;

  @ApiProperty({
    description:
      'Nom (gardé tel quel si ce numéro appartient déjà à un utilisateur)',
    example: 'Keita',
  })
  @Trim()
  @IsString({ message: 'Le nom est requis' })
  @Length(1, 100, { message: 'Le nom doit contenir 1 à 100 caractères' })
  lastName: string;
}

export class BeneficiaryInput {
  @ApiProperty({
    description: 'Nom complet du bénéficiaire',
    example: 'Ali Keita',
  })
  @Trim()
  @IsString({ message: 'Le nom du bénéficiaire est requis' })
  @Length(1, 100, {
    message: 'Le nom du bénéficiaire doit contenir 1 à 100 caractères',
  })
  name: string;

  @ApiPropertyOptional({
    description: `Numéro du bénéficiaire, ${PHONE_DESCRIPTION} ; facultatif (absent ou \`null\` : pas de numéro)`,
    example: '76 77 88 99',
    nullable: true,
    type: String,
  })
  @IsOptional()
  @Trim()
  @IsString({ message: 'Le numéro du bénéficiaire est invalide' })
  @Length(1, 30, { message: 'Le numéro du bénéficiaire est invalide' })
  phone?: string | null;
}

export class OpenAccountDto {
  @ApiProperty({
    description:
      'Le client : trouvé par son numéro, ou créé (sans PIN : il active l’application par code SMS)',
  })
  @IsObject({ message: CUSTOMER_MESSAGE })
  @ValidateNested({ message: CUSTOMER_MESSAGE })
  @Type(() => CustomerInput)
  customer: CustomerInput;

  @ApiPropertyOptional({
    description:
      'Personne qui peut recevoir l’épargne (facultatif ; un numéro exige un nom)',
  })
  @IsOptional()
  @IsObject({ message: BENEFICIARY_MESSAGE })
  @ValidateNested({ message: BENEFICIARY_MESSAGE })
  @Type(() => BeneficiaryInput)
  beneficiary?: BeneficiaryInput;

  @ApiProperty({
    description:
      'Le client a accepté les conditions de la quincaillerie au comptoir ; doit valoir `true`',
    example: true,
  })
  @Equals(true, {
    message: 'Le client doit accepter les conditions de la quincaillerie',
  })
  termsAccepted: true;
}
