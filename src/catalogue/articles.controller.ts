import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { ErrorResponse } from '../common/errors/error-response.js';
import {
  ApiPaginatedResponse,
  PaginationQueryDto,
  type Paginated,
} from '../common/pagination.js';
import type { AuthenticatedUser } from '../mobile-auth/authenticated-user.js';
import { CurrentUser } from '../mobile-auth/decorators/current-user.decorator.js';
import { MobileRoute } from '../mobile-auth/decorators/mobile-route.decorator.js';
import type { CurrentStoreContext } from '../store-access/current-store.js';
import { CurrentStore } from '../store-access/decorators/current-store.decorator.js';
import { StoreRoles } from '../store-access/decorators/store-roles.decorator.js';
import { invalidArticleId } from './catalogue.errors.js';
import { CatalogueService } from './catalogue.service.js';
import {
  ArticleView,
  CreateArticleDto,
  ListArticlesQueryDto,
  UpdateArticleDto,
} from './dto/article.js';
import { ChangePriceDto, PriceHistoryEntry } from './dto/price.js';

const ArticleIdPipe = new ParseUUIDPipe({ exceptionFactory: invalidArticleId });

@ApiTags('Mobile - Catalogue de la quincaillerie')
@ApiBearerAuth()
@ApiParam({ name: 'storeId', description: 'Identifiant de la quincaillerie' })
@ApiUnauthorizedResponse({
  description: 'Session absente, expirée ou fermée',
  type: ErrorResponse,
})
@ApiNotFoundResponse({
  description:
    'Quincaillerie introuvable : vous n’en êtes pas membre actif, ou article ou catégorie introuvable',
  type: ErrorResponse,
})
// Every route answers 400 to a malformed store id (StoreAccessGuard). A route
// that declares its own 400 replaces this one, so it names the store id too.
@ApiBadRequestResponse({
  description: 'Identifiant de quincaillerie invalide',
  type: ErrorResponse,
})
@MobileRoute()
@Controller('stores/:storeId/articles')
export class ArticlesController {
  constructor(private readonly catalogue: CatalogueService) {}

  /**
   * @description List the store's articles by name, with filters and search
   * @route GET /api/v1/stores/:storeId/articles
   * @access Store manager or seller (mobile session)
   * @param storeId the store
   * @query ListArticlesQueryDto (page, pageSize, categoryId?, available?, q?)
   * @returns 200 Paginated<ArticleView>
   */
  @Get()
  @StoreRoles(['MANAGER', 'SELLER'])
  @ApiOperation({
    summary: 'Articles du catalogue',
    description:
      'Par nom, paginés. Filtres : catégorie, disponibilité, recherche dans le nom (sans tenir compte des majuscules).',
  })
  @ApiPaginatedResponse(ArticleView, 'Articles')
  @ApiBadRequestResponse({
    description:
      'Identifiant de quincaillerie invalide ; filtre ou pagination invalide (`details`)',
    type: ErrorResponse,
  })
  articles(
    @CurrentStore() store: CurrentStoreContext,
    @Query() query: ListArticlesQueryDto,
  ): Promise<Paginated<ArticleView>> {
    return this.catalogue.articles(store.storeId, query);
  }

  /**
   * @description Create an article with its price of the day (the first price history entry)
   * @route POST /api/v1/stores/:storeId/articles
   * @access Store manager (mobile session)
   * @param storeId the store
   * @body CreateArticleDto (name, categoryId, unit, price, available?)
   * @returns 201 ArticleView; 404 category not in this store; 409 ARTICLE_EXISTS or STORE_CLOSED
   */
  @Post()
  @StoreRoles(['MANAGER'])
  @ApiOperation({
    summary: 'Créer un article',
    description:
      'Le prix devient le prix du jour et la première entrée de l’historique des prix. Le nom est unique dans la quincaillerie, sans tenir compte des majuscules. Impossible dans une quincaillerie fermée.',
  })
  @ApiCreatedResponse({ description: 'Article créé', type: ArticleView })
  @ApiBadRequestResponse({
    description:
      'Identifiant de quincaillerie invalide ; données invalides (`details`)',
    type: ErrorResponse,
  })
  @ApiForbiddenResponse({
    description: 'Membre sans le rôle de gérant (`STORE_ROLE_REQUIRED`)',
    type: ErrorResponse,
  })
  @ApiConflictResponse({
    description:
      'Nom déjà utilisé (`ARTICLE_EXISTS`) ; quincaillerie fermée (`STORE_CLOSED`)',
    type: ErrorResponse,
  })
  createArticle(
    @CurrentStore() store: CurrentStoreContext,
    @CurrentUser() actor: AuthenticatedUser,
    @Body() body: CreateArticleDto,
  ): Promise<ArticleView> {
    return this.catalogue.createArticle(store.storeId, actor, body);
  }

  /**
   * @description One article of the store
   * @route GET /api/v1/stores/:storeId/articles/:articleId
   * @access Store manager or seller (mobile session)
   * @param storeId the store
   * @param articleId the article
   * @returns 200 ArticleView
   */
  @Get(':articleId')
  @StoreRoles(['MANAGER', 'SELLER'])
  @ApiOperation({ summary: 'Détail d’un article' })
  @ApiParam({ name: 'articleId', description: 'Identifiant de l’article' })
  @ApiOkResponse({ description: 'Article', type: ArticleView })
  @ApiBadRequestResponse({
    description: 'Identifiant de quincaillerie ou d’article invalide',
    type: ErrorResponse,
  })
  article(
    @CurrentStore() store: CurrentStoreContext,
    @Param('articleId', ArticleIdPipe) articleId: string,
  ): Promise<ArticleView> {
    return this.catalogue.article(store.storeId, articleId);
  }

  /**
   * @description Change an article's name, category, unit, or availability (the price has its own route)
   * @route PATCH /api/v1/stores/:storeId/articles/:articleId
   * @access Store manager (mobile session)
   * @param storeId the store
   * @param articleId the article
   * @body UpdateArticleDto (name?, categoryId?, unit?, available?)
   * @returns 200 ArticleView; 400 nothing to update; 409 ARTICLE_EXISTS or STORE_CLOSED
   */
  @Patch(':articleId')
  @StoreRoles(['MANAGER'])
  @ApiOperation({
    summary: 'Modifier un article',
    description:
      'Nom, catégorie, unité et/ou disponibilité. Un article n’est jamais supprimé : on le retire de la vente (`available: false`). Le prix se change par la route des prix, pour garder l’historique.',
  })
  @ApiParam({ name: 'articleId', description: 'Identifiant de l’article' })
  @ApiOkResponse({ description: 'Article modifié', type: ArticleView })
  @ApiBadRequestResponse({
    description:
      'Identifiant de quincaillerie ou d’article invalide ; rien à modifier ; données invalides (`details`)',
    type: ErrorResponse,
  })
  @ApiForbiddenResponse({
    description: 'Membre sans le rôle de gérant (`STORE_ROLE_REQUIRED`)',
    type: ErrorResponse,
  })
  @ApiConflictResponse({
    description:
      'Nom déjà utilisé (`ARTICLE_EXISTS`) ; quincaillerie fermée (`STORE_CLOSED`)',
    type: ErrorResponse,
  })
  updateArticle(
    @CurrentStore() store: CurrentStoreContext,
    @CurrentUser() actor: AuthenticatedUser,
    @Param('articleId', ArticleIdPipe) articleId: string,
    @Body() body: UpdateArticleDto,
  ): Promise<ArticleView> {
    return this.catalogue.updateArticle(store.storeId, actor, articleId, body);
  }

  /**
   * @description Change an article's price of the day, at once (a new price history entry)
   * @route POST /api/v1/stores/:storeId/articles/:articleId/prices
   * @access Store manager (mobile session)
   * @param storeId the store
   * @param articleId the article
   * @body ChangePriceDto (price)
   * @returns 201 ArticleView; 409 PRICE_UNCHANGED or STORE_CLOSED
   */
  @Post(':articleId/prices')
  @StoreRoles(['MANAGER'])
  @ApiOperation({
    summary: 'Changer le prix du jour',
    description:
      'Le nouveau prix s’applique tout de suite et s’ajoute à l’historique des prix, qui ne se modifie jamais. Impossible dans une quincaillerie fermée.',
  })
  @ApiParam({ name: 'articleId', description: 'Identifiant de l’article' })
  @ApiCreatedResponse({
    description: 'Prix changé : l’article avec son nouveau prix',
    type: ArticleView,
  })
  @ApiBadRequestResponse({
    description:
      'Identifiant de quincaillerie ou d’article invalide ; prix invalide (`details`)',
    type: ErrorResponse,
  })
  @ApiForbiddenResponse({
    description: 'Membre sans le rôle de gérant (`STORE_ROLE_REQUIRED`)',
    type: ErrorResponse,
  })
  @ApiConflictResponse({
    description:
      'Même prix que le prix du jour (`PRICE_UNCHANGED`) ; quincaillerie fermée (`STORE_CLOSED`)',
    type: ErrorResponse,
  })
  changePrice(
    @CurrentStore() store: CurrentStoreContext,
    @CurrentUser() actor: AuthenticatedUser,
    @Param('articleId', ArticleIdPipe) articleId: string,
    @Body() body: ChangePriceDto,
  ): Promise<ArticleView> {
    return this.catalogue.changePrice(store.storeId, actor, articleId, body);
  }

  /**
   * @description List the prices an article has had, newest first
   * @route GET /api/v1/stores/:storeId/articles/:articleId/prices
   * @access Store manager or seller (mobile session)
   * @param storeId the store
   * @param articleId the article
   * @query PaginationQueryDto (page, pageSize)
   * @returns 200 Paginated<PriceHistoryEntry>
   */
  @Get(':articleId/prices')
  @StoreRoles(['MANAGER', 'SELLER'])
  @ApiOperation({
    summary: 'Historique des prix',
    description:
      'Tous les prix de l’article depuis sa création, du plus récent au plus ancien. Le premier est le prix du jour.',
  })
  @ApiParam({ name: 'articleId', description: 'Identifiant de l’article' })
  @ApiPaginatedResponse(PriceHistoryEntry, 'Historique des prix')
  @ApiBadRequestResponse({
    description:
      'Identifiant de quincaillerie ou d’article invalide ; pagination invalide (`details`)',
    type: ErrorResponse,
  })
  priceHistory(
    @CurrentStore() store: CurrentStoreContext,
    @Param('articleId', ArticleIdPipe) articleId: string,
    @Query() query: PaginationQueryDto,
  ): Promise<Paginated<PriceHistoryEntry>> {
    return this.catalogue.priceHistory(store.storeId, articleId, query);
  }
}
