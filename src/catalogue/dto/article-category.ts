import { ApiProperty } from '@nestjs/swagger';
import { IsString, Length } from 'class-validator';
import { Trim } from '../../common/validation/trim.js';
import type { ArticleCategory } from '../../generated/prisma/client.js';

const NAME_MESSAGE = 'Le nom de la catégorie doit contenir 1 à 60 caractères';

/** Creating or renaming a category: the same single field. */
export class CategoryNameDto {
  @ApiProperty({ description: 'Nom de la catégorie', example: 'Ciment' })
  @Trim()
  @IsString({ message: NAME_MESSAGE })
  @Length(1, 60, { message: NAME_MESSAGE })
  name: string;
}

export class ArticleCategoryView {
  @ApiProperty({
    description: 'Identifiant de la catégorie',
    example: '0192f0a4-7b1c-7c3e-9d2a-5e6f7a8b9c0d',
  })
  id: string;

  @ApiProperty({ description: 'Nom', example: 'Ciment' })
  name: string;

  @ApiProperty({
    description: 'Date de création',
    example: '2026-10-23T10:00:00.000Z',
  })
  createdAt: Date;
}

/** Categories are listed by name. */
export const CATEGORIES_ORDER = [{ name: 'asc' }, { id: 'asc' }] as const;

export function toArticleCategoryView(
  category: ArticleCategory,
): ArticleCategoryView {
  return {
    id: category.id,
    name: category.name,
    createdAt: category.createdAt,
  };
}
