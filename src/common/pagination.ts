import { applyDecorators, type Type as ClassType } from '@nestjs/common';
import {
  ApiExtraModels,
  ApiOkResponse,
  ApiProperty,
  ApiPropertyOptional,
  getSchemaPath,
} from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, Max, Min } from 'class-validator';
import { Prisma } from '../generated/prisma/client.js';

export const MAX_PAGE_SIZE = 100;

/**
 * Options of the batch transaction that reads a page and its counts:
 * `prisma.$transaction([findMany, count], ONE_SNAPSHOT)`. At PostgreSQL's
 * default READ COMMITTED, each statement sees what was committed when it
 * starts, so a write landing in between can make the total disagree with the
 * page. At REPEATABLE READ every statement reads the snapshot taken by the
 * first one. The transaction only reads, so it never fails with a
 * serialization error at this level (F-03).
 */
export const ONE_SNAPSHOT = {
  isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
} as const;
// Bounds `skip` (at most 10 million rows) so Prisma never gets an oversized value.
export const MAX_PAGE = 100_000;
const PAGE_MESSAGE = `Le numéro de page doit être un entier entre 1 et ${MAX_PAGE}`;
const PAGE_SIZE_MESSAGE = `La taille de page doit être un entier entre 1 et ${MAX_PAGE_SIZE}`;

/**
 * Query parameters shared by every list endpoint: `?page=2&pageSize=20`.
 * List DTOs extend it with their own filters.
 */
export class PaginationQueryDto {
  @ApiPropertyOptional({
    description: 'Numéro de page, à partir de 1',
    default: 1,
    minimum: 1,
    maximum: MAX_PAGE,
  })
  // Query values arrive as text; @Type converts "2" to 2 before validation.
  @Type(() => Number)
  @IsInt({ message: PAGE_MESSAGE })
  @Min(1, { message: PAGE_MESSAGE })
  @Max(MAX_PAGE, { message: PAGE_MESSAGE })
  page: number = 1;

  @ApiPropertyOptional({
    description: `Nombre d’éléments par page (au plus ${MAX_PAGE_SIZE})`,
    default: 20,
    minimum: 1,
    maximum: MAX_PAGE_SIZE,
  })
  @Type(() => Number)
  @IsInt({ message: PAGE_SIZE_MESSAGE })
  @Min(1, { message: PAGE_SIZE_MESSAGE })
  @Max(MAX_PAGE_SIZE, { message: PAGE_SIZE_MESSAGE })
  pageSize: number = 20;
}

/** Prisma `skip` / `take` for a page. */
export function toSkipTake(query: PaginationQueryDto): {
  skip: number;
  take: number;
} {
  return { skip: (query.page - 1) * query.pageSize, take: query.pageSize };
}

/** Response of every list endpoint. A page past the end has no items but the real total. */
export interface Paginated<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

export function paginated<T>(
  items: T[],
  total: number,
  query: PaginationQueryDto,
): Paginated<T> {
  return { items, total, page: query.page, pageSize: query.pageSize };
}

/** The non-generic part of the response, for Swagger. */
export class PaginationMeta {
  @ApiProperty({
    description: 'Nombre total d’éléments, toutes pages confondues',
    example: 42,
  })
  total: number;

  @ApiProperty({ description: 'Numéro de la page renvoyée', example: 1 })
  page: number;

  @ApiProperty({ description: 'Taille de page demandée', example: 20 })
  pageSize: number;
}

/**
 * Documents a paginated response with the real item type:
 * `@ApiPaginatedResponse(StoreSummary, 'Liste des quincailleries')`.
 */
export function ApiPaginatedResponse(
  itemType: ClassType<unknown>,
  description: string,
): MethodDecorator & ClassDecorator {
  return applyDecorators(
    ApiExtraModels(PaginationMeta, itemType),
    ApiOkResponse({
      description,
      schema: {
        allOf: [
          { $ref: getSchemaPath(PaginationMeta) },
          {
            properties: {
              items: {
                type: 'array',
                items: { $ref: getSchemaPath(itemType) },
              },
            },
            required: ['items'],
          },
        ],
      },
    }),
  );
}
