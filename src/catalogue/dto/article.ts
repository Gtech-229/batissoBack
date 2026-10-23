import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  ValidateIf,
} from 'class-validator';
import { formatAmount, IsAmount } from '../../common/money.js';
import { PaginationQueryDto } from '../../common/pagination.js';
import { Trim } from '../../common/validation/trim.js';
import type {
  Article,
  ArticleCategory,
} from '../../generated/prisma/client.js';

const NAME_MESSAGE = 'Le nom de l’article doit contenir 1 à 100 caractères';
const UNIT_MESSAGE = 'L’unité doit contenir 1 à 50 caractères';
const CATEGORY_MESSAGE = 'Identifiant de catégorie invalide';
const AVAILABLE_MESSAGE = 'La disponibilité doit être true ou false';

export class CreateArticleDto {
  @ApiProperty({ description: 'Nom de l’article', example: 'Ciment CPA 45' })
  @Trim()
  @IsString({ message: NAME_MESSAGE })
  @Length(1, 100, { message: NAME_MESSAGE })
  name: string;

  @ApiProperty({
    description: 'Catégorie de la quincaillerie',
    example: '0192f0a4-7b1c-7c3e-9d2a-5e6f7a8b9c0d',
  })
  @IsUUID('all', { message: CATEGORY_MESSAGE })
  categoryId: string;

  @ApiProperty({ description: 'Unité de vente', example: 'sac de 50 kg' })
  @Trim()
  @IsString({ message: UNIT_MESSAGE })
  @Length(1, 50, { message: UNIT_MESSAGE })
  unit: string;

  @ApiProperty({
    description: 'Prix du jour, en unités de la devise, en texte',
    example: '5000',
  })
  @IsAmount()
  price: string;

  @ApiPropertyOptional({
    description: 'En vente (par défaut : oui)',
    default: true,
  })
  @IsOptional()
  @IsBoolean({ message: AVAILABLE_MESSAGE })
  available?: boolean;
}

/**
 * Partial update: what is omitted keeps its value; null is refused. The price
 * has its own route, so that every change lands in the price history.
 */
export class UpdateArticleDto {
  @ApiPropertyOptional({
    description: 'Nouveau nom',
    example: 'Ciment CPA 42.5',
  })
  @ValidateIf((_object, value) => value !== undefined)
  @Trim()
  @IsString({ message: NAME_MESSAGE })
  @Length(1, 100, { message: NAME_MESSAGE })
  name?: string;

  @ApiPropertyOptional({
    description: 'Nouvelle catégorie de la quincaillerie',
    example: '0192f0a4-7b1c-7c3e-9d2a-5e6f7a8b9c0d',
  })
  @ValidateIf((_object, value) => value !== undefined)
  @IsUUID('all', { message: CATEGORY_MESSAGE })
  categoryId?: string;

  @ApiPropertyOptional({
    description: 'Nouvelle unité',
    example: 'sac de 25 kg',
  })
  @ValidateIf((_object, value) => value !== undefined)
  @Trim()
  @IsString({ message: UNIT_MESSAGE })
  @Length(1, 50, { message: UNIT_MESSAGE })
  unit?: string;

  @ApiPropertyOptional({ description: 'En vente ou non', example: false })
  @ValidateIf((_object, value) => value !== undefined)
  @IsBoolean({ message: AVAILABLE_MESSAGE })
  available?: boolean;
}

/** `GET /stores/:storeId/articles?categoryId=...&available=true&q=ciment` */
export class ListArticlesQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ description: 'Seulement cette catégorie' })
  @IsOptional()
  @IsUUID('all', { message: CATEGORY_MESSAGE })
  categoryId?: string;

  @ApiPropertyOptional({
    description:
      'Seulement les articles en vente (`true`) ou retirés (`false`)',
    enum: ['true', 'false'],
  })
  @IsOptional()
  // Query values arrive as text: compared as text, never converted loosely.
  @IsIn(['true', 'false'], { message: AVAILABLE_MESSAGE })
  available?: 'true' | 'false';

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

export class ArticleCategoryRef {
  @ApiProperty({
    description: 'Identifiant de la catégorie',
    example: '0192f0a4-7b1c-7c3e-9d2a-5e6f7a8b9c0d',
  })
  id: string;

  @ApiProperty({ description: 'Nom', example: 'Ciment' })
  name: string;
}

export class ArticleView {
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
  currentPrice: string;

  @ApiProperty({ description: 'Devise (ISO 4217)', example: 'XOF' })
  currencyCode: string;

  @ApiProperty({ description: 'En vente', example: true })
  available: boolean;

  @ApiProperty({
    description: 'Date de création',
    example: '2026-10-23T10:00:00.000Z',
  })
  createdAt: Date;

  @ApiProperty({
    description: 'Dernière modification',
    example: '2026-10-23T10:00:00.000Z',
  })
  updatedAt: Date;
}

/** What `toArticleView` needs: the category and the store's currency. */
export const ARTICLE_INCLUDE = {
  category: true,
  store: { select: { country: { select: { currencyCode: true } } } },
} as const;

/** Articles are listed by name; id breaks ties. */
export const ARTICLES_ORDER = [{ name: 'asc' }, { id: 'asc' }] as const;

export type ArticleWithCategory = Article & {
  category: ArticleCategory;
  store: { country: { currencyCode: string } };
};

export function toArticleView(article: ArticleWithCategory): ArticleView {
  return {
    id: article.id,
    name: article.name,
    category: { id: article.category.id, name: article.category.name },
    unit: article.unit,
    currentPrice: formatAmount(article.currentPrice),
    currencyCode: article.store.country.currencyCode,
    available: article.available,
    createdAt: article.createdAt,
    updatedAt: article.updatedAt,
  };
}
