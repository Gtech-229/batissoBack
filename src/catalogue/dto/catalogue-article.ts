import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, IsUUID, Length } from 'class-validator';
import { formatAmount } from '../../common/money.js';
import { PaginationQueryDto } from '../../common/pagination.js';
import { Trim } from '../../common/validation/trim.js';
import { materialEquivalence } from '../equivalence.js';
import { ArticleCategoryRef, type ArticleWithCategory } from './article.js';

/** `GET /me/accounts/:accountId/articles?goalId=...&categoryId=...&q=ciment` */
export class ListMyArticlesQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({
    description:
      'Un objectif du compte : les quantités se calculent sur son solde plutôt que sur celui du compte',
  })
  @IsOptional()
  @IsUUID('all', { message: 'Identifiant d’objectif invalide' })
  goalId?: string;

  @ApiPropertyOptional({ description: 'Seulement cette catégorie' })
  @IsOptional()
  @IsUUID('all', { message: 'Identifiant de catégorie invalide' })
  categoryId?: string;

  @ApiPropertyOptional({
    description:
      'Recherche dans le nom de l’article, sans tenir compte des majuscules',
    example: 'ciment',
  })
  @IsOptional()
  @Trim()
  @IsString({ message: 'La recherche doit être un texte' })
  @Length(1, 100, { message: 'La recherche doit contenir 1 à 100 caractères' })
  q?: string;
}

/** An article on sale, seen by a customer, with what their savings buy. */
export class CatalogueArticle {
  @ApiProperty({
    description: 'Identifiant de l’article',
    example: '0192f0a4-7b1c-7c3e-9d2a-5e6f7a8b9c0d',
  })
  id: string;

  @ApiProperty({ description: 'Nom', example: 'Ciment CPA 45' })
  name: string;

  @ApiProperty({ description: 'Catégorie', type: ArticleCategoryRef })
  category: ArticleCategoryRef;

  @ApiProperty({ description: 'Unité de vente', example: 'sac de 50 kg' })
  unit: string;

  @ApiProperty({
    description: 'Prix du jour, en unités de la devise, en texte',
    example: '5000',
  })
  unitPrice: string;

  @ApiProperty({ description: 'Devise (ISO 4217)', example: 'XOF' })
  currencyCode: string;

  @ApiProperty({
    description:
      'Unités entières que le solde du compte (ou de l’objectif demandé) achète au prix du jour, en texte',
    example: '6',
  })
  quantity: string;
}

export function toCatalogueArticle(
  article: ArticleWithCategory,
  balance: bigint,
): CatalogueArticle {
  return {
    id: article.id,
    name: article.name,
    category: { id: article.category.id, name: article.category.name },
    unit: article.unit,
    unitPrice: formatAmount(article.currentPrice),
    currencyCode: article.store.country.currencyCode,
    quantity: materialEquivalence(
      balance,
      null,
      article.currentPrice,
    ).quantity.toString(),
  };
}
