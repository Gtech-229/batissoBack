import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
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
import type { AuthenticatedUser } from '../mobile-auth/authenticated-user.js';
import { CurrentUser } from '../mobile-auth/decorators/current-user.decorator.js';
import { MobileRoute } from '../mobile-auth/decorators/mobile-route.decorator.js';
import type { CurrentStoreContext } from '../store-access/current-store.js';
import { CurrentStore } from '../store-access/decorators/current-store.decorator.js';
import { StoreRoles } from '../store-access/decorators/store-roles.decorator.js';
import { invalidCategoryId } from './catalogue.errors.js';
import { CatalogueService } from './catalogue.service.js';
import {
  ArticleCategoryView,
  CategoryNameDto,
} from './dto/article-category.js';

const CategoryIdPipe = new ParseUUIDPipe({
  exceptionFactory: invalidCategoryId,
});

@ApiTags('Mobile - Catalogue de la quincaillerie')
@ApiBearerAuth()
@ApiParam({ name: 'storeId', description: 'Identifiant de la quincaillerie' })
@ApiUnauthorizedResponse({
  description: 'Session absente, expirée ou fermée',
  type: ErrorResponse,
})
@ApiNotFoundResponse({
  description:
    'Quincaillerie introuvable : vous n’en êtes pas membre actif, ou catégorie introuvable',
  type: ErrorResponse,
})
// Every route answers 400 to a malformed store id (StoreAccessGuard). A route
// that declares its own 400 replaces this one, so it names the store id too.
@ApiBadRequestResponse({
  description: 'Identifiant de quincaillerie invalide',
  type: ErrorResponse,
})
@MobileRoute()
@Controller('stores/:storeId/article-categories')
export class ArticleCategoriesController {
  constructor(private readonly catalogue: CatalogueService) {}

  /**
   * @description List the store's article categories, by name
   * @route GET /api/v1/stores/:storeId/article-categories
   * @access Store manager or seller (mobile session)
   * @param storeId the store
   * @returns 200 ArticleCategoryView[]
   */
  @Get()
  @StoreRoles(['MANAGER', 'SELLER'])
  @ApiOperation({
    summary: 'Catégories d’articles',
    description:
      'Les catégories du catalogue de la quincaillerie, par nom. Une nouvelle quincaillerie commence avec un jeu de catégories par défaut.',
  })
  @ApiOkResponse({ description: 'Catégories', type: [ArticleCategoryView] })
  categories(
    @CurrentStore() store: CurrentStoreContext,
  ): Promise<ArticleCategoryView[]> {
    return this.catalogue.categories(store.storeId);
  }

  /**
   * @description Create an article category (name unique in the store, ignoring case)
   * @route POST /api/v1/stores/:storeId/article-categories
   * @access Store manager (mobile session)
   * @param storeId the store
   * @body CategoryNameDto (name)
   * @returns 201 ArticleCategoryView; 409 CATEGORY_EXISTS or STORE_CLOSED
   */
  @Post()
  @StoreRoles(['MANAGER'])
  @ApiOperation({
    summary: 'Créer une catégorie',
    description:
      'Le nom est unique dans la quincaillerie, sans tenir compte des majuscules. Impossible dans une quincaillerie fermée.',
  })
  @ApiCreatedResponse({
    description: 'Catégorie créée',
    type: ArticleCategoryView,
  })
  @ApiBadRequestResponse({
    description:
      'Identifiant de quincaillerie invalide ; nom invalide (`details`)',
    type: ErrorResponse,
  })
  @ApiForbiddenResponse({
    description: 'Membre sans le rôle de gérant (`STORE_ROLE_REQUIRED`)',
    type: ErrorResponse,
  })
  @ApiConflictResponse({
    description:
      'Nom déjà utilisé (`CATEGORY_EXISTS`) ; quincaillerie fermée (`STORE_CLOSED`)',
    type: ErrorResponse,
  })
  createCategory(
    @CurrentStore() store: CurrentStoreContext,
    @CurrentUser() actor: AuthenticatedUser,
    @Body() body: CategoryNameDto,
  ): Promise<ArticleCategoryView> {
    return this.catalogue.createCategory(store.storeId, actor, body);
  }

  /**
   * @description Rename an article category (its articles keep it)
   * @route PATCH /api/v1/stores/:storeId/article-categories/:categoryId
   * @access Store manager (mobile session)
   * @param storeId the store
   * @param categoryId the category
   * @body CategoryNameDto (name)
   * @returns 200 ArticleCategoryView; 409 CATEGORY_EXISTS or STORE_CLOSED
   */
  @Patch(':categoryId')
  @StoreRoles(['MANAGER'])
  @ApiOperation({
    summary: 'Renommer une catégorie',
    description:
      'Ses articles la gardent. Le nom est unique dans la quincaillerie, sans tenir compte des majuscules. Impossible dans une quincaillerie fermée.',
  })
  @ApiParam({ name: 'categoryId', description: 'Identifiant de la catégorie' })
  @ApiOkResponse({
    description: 'Catégorie renommée',
    type: ArticleCategoryView,
  })
  @ApiBadRequestResponse({
    description:
      'Identifiant de quincaillerie ou de catégorie invalide ; nom invalide (`details`)',
    type: ErrorResponse,
  })
  @ApiForbiddenResponse({
    description: 'Membre sans le rôle de gérant (`STORE_ROLE_REQUIRED`)',
    type: ErrorResponse,
  })
  @ApiConflictResponse({
    description:
      'Nom déjà utilisé (`CATEGORY_EXISTS`) ; quincaillerie fermée (`STORE_CLOSED`)',
    type: ErrorResponse,
  })
  renameCategory(
    @CurrentStore() store: CurrentStoreContext,
    @CurrentUser() actor: AuthenticatedUser,
    @Param('categoryId', CategoryIdPipe) categoryId: string,
    @Body() body: CategoryNameDto,
  ): Promise<ArticleCategoryView> {
    return this.catalogue.renameCategory(
      store.storeId,
      actor,
      categoryId,
      body,
    );
  }
}
