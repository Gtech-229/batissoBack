import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, IsUUID, Length, ValidateIf } from 'class-validator';
import { IsAmount } from '../../common/money.js';
import { Trim } from '../../common/validation/trim.js';

const NAME_MESSAGE = 'Le nom du projet doit contenir 1 à 100 caractères';
const LABEL_MESSAGE = 'Le libellé doit contenir 1 à 100 caractères';
const ARTICLE_MESSAGE = 'Identifiant d’article invalide';

export class CreateProjectDto {
  @ApiProperty({ description: 'Nom du projet', example: 'Ma maison' })
  @Trim()
  @IsString({ message: NAME_MESSAGE })
  @Length(1, 100, { message: NAME_MESSAGE })
  name: string;
}

export class CreateGoalDto {
  @ApiProperty({ description: 'Libellé de l’objectif', example: 'Ciment' })
  @Trim()
  @IsString({ message: LABEL_MESSAGE })
  @Length(1, 100, { message: LABEL_MESSAGE })
  label: string;

  @ApiProperty({
    description: 'Montant visé, en unités de la devise, en texte',
    example: '150000',
  })
  @IsAmount()
  targetAmount: string;

  @ApiPropertyOptional({
    description: 'Projet du compte auquel rattacher l’objectif',
    example: '0192f0a4-7b1c-7c3e-9d2a-5e6f7a8b9c0d',
  })
  // Omitted means none; null is refused (F-05), never passed on to Prisma.
  @ValidateIf((_object, value) => value !== undefined)
  @IsUUID('all', { message: 'Identifiant de projet invalide' })
  projectId?: string;

  @ApiPropertyOptional({
    description:
      'Article en vente de la quincaillerie du compte : l’objectif montre son solde en quantité de cet article',
    example: '0192f0a4-7b1c-7c3e-9d2a-5e6f7a8b9c0d',
  })
  @ValidateIf((_object, value) => value !== undefined)
  @IsUUID('all', { message: ARTICLE_MESSAGE })
  articleId?: string;
}

/** Partial update: what is omitted keeps its value; null is refused, except to unlink the article. */
export class UpdateGoalDto {
  @ApiPropertyOptional({
    description: 'Nouveau libellé',
    example: 'Ciment CPA',
  })
  @ValidateIf((_object, value) => value !== undefined)
  @Trim()
  @IsString({ message: LABEL_MESSAGE })
  @Length(1, 100, { message: LABEL_MESSAGE })
  label?: string;

  @ApiPropertyOptional({
    description: 'Nouveau montant visé, en texte',
    example: '200000',
  })
  @ValidateIf((_object, value) => value !== undefined)
  @IsAmount()
  targetAmount?: string;

  @ApiPropertyOptional({
    description:
      'Article en vente de la quincaillerie du compte ; `null` retire le lien',
    example: '0192f0a4-7b1c-7c3e-9d2a-5e6f7a8b9c0d',
    nullable: true,
    type: String,
  })
  // null is accepted here, unlike the other fields: it unlinks the article.
  @ValidateIf((_object, value) => value !== undefined && value !== null)
  @IsUUID('all', { message: ARTICLE_MESSAGE })
  articleId?: string | null;
}
