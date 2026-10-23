import { Controller, Get, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { invalidAccountId } from '../accounts/accounts.errors.js';
import { ErrorResponse } from '../common/errors/error-response.js';
import { ApiPaginatedResponse, type Paginated } from '../common/pagination.js';
import type { AuthenticatedUser } from '../mobile-auth/authenticated-user.js';
import { CurrentUser } from '../mobile-auth/decorators/current-user.decorator.js';
import { MobileRoute } from '../mobile-auth/decorators/mobile-route.decorator.js';
import { CatalogueService } from './catalogue.service.js';
import { ArticleCategoryView } from './dto/article-category.js';
import {
  CatalogueArticle,
  ListMyArticlesQueryDto,
} from './dto/catalogue-article.js';

const AccountIdPipe = new ParseUUIDPipe({ exceptionFactory: invalidAccountId });

@ApiTags('Mobile - Catalogue de ma quincaillerie')
@ApiBearerAuth()
@ApiParam({ name: 'accountId', description: 'Identifiant de mon compte' })
@ApiUnauthorizedResponse({
  description: 'Session absente, expirée ou fermée',
  type: ErrorResponse,
})
@ApiNotFoundResponse({
  description:
    'Compte introuvable parmi les vôtres, ou objectif introuvable sur ce compte',
  type: ErrorResponse,
})
@ApiBadRequestResponse({
  description: 'Identifiant de compte invalide',
  type: ErrorResponse,
})
@MobileRoute()
@Controller('me/accounts/:accountId')
export class MyCatalogueController {
  constructor(private readonly catalogue: CatalogueService) {}

  /**
   * @description List the article categories of the store of one of the user's accounts
   * @route GET /api/v1/me/accounts/:accountId/article-categories
   * @access Mobile session (Bearer), the account's customer only
   * @param accountId one of the user's accounts
   * @returns 200 ArticleCategoryView[]
   */
  @Get('article-categories')
  @ApiOperation({
    summary: 'Catégories d’articles de ma quincaillerie',
    description:
      'Les catégories du catalogue de la quincaillerie du compte, par nom.',
  })
  @ApiOkResponse({ description: 'Catégories', type: [ArticleCategoryView] })
  categories(
    @CurrentUser() user: AuthenticatedUser,
    @Param('accountId', AccountIdPipe) accountId: string,
  ): Promise<ArticleCategoryView[]> {
    return this.catalogue.myCategories(user.userId, accountId);
  }

  /**
   * @description List the articles on sale in the store of one of the user's accounts, with what the savings buy
   * @route GET /api/v1/me/accounts/:accountId/articles
   * @access Mobile session (Bearer), the account's customer only
   * @param accountId one of the user's accounts
   * @query ListMyArticlesQueryDto (page, pageSize, goalId?, categoryId?, q?)
   * @returns 200 Paginated<CatalogueArticle>; 404 goal not on this account
   */
  @Get('articles')
  @ApiOperation({
    summary: 'Catalogue de ma quincaillerie',
    description:
      'Les articles en vente, par nom, paginés, avec le prix du jour et la quantité entière que le solde du compte permet d’acheter. Avec `goalId`, la quantité se calcule sur le solde de cet objectif.',
  })
  @ApiPaginatedResponse(CatalogueArticle, 'Articles en vente')
  @ApiBadRequestResponse({
    description:
      'Identifiant de compte invalide ; filtre ou pagination invalide (`details`)',
    type: ErrorResponse,
  })
  articles(
    @CurrentUser() user: AuthenticatedUser,
    @Param('accountId', AccountIdPipe) accountId: string,
    @Query() query: ListMyArticlesQueryDto,
  ): Promise<Paginated<CatalogueArticle>> {
    return this.catalogue.myArticles(user.userId, accountId, query);
  }
}
