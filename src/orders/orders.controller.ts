import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
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
import { invalidAccountId } from '../accounts/accounts.errors.js';
import { ErrorResponse } from '../common/errors/error-response.js';
import { ApiPaginatedResponse, type Paginated } from '../common/pagination.js';
import type { AuthenticatedUser } from '../mobile-auth/authenticated-user.js';
import { CurrentUser } from '../mobile-auth/decorators/current-user.decorator.js';
import { MobileRoute } from '../mobile-auth/decorators/mobile-route.decorator.js';
import type { CurrentStoreContext } from '../store-access/current-store.js';
import { CurrentStore } from '../store-access/decorators/current-store.decorator.js';
import { StoreRoles } from '../store-access/decorators/store-roles.decorator.js';
import { ListOrdersQueryDto } from './dto/list-orders.dto.js';
import { CancelOrderDto, RefuseOrderDto } from './dto/order-decisions.dto.js';
import { OrderView } from './dto/order-view.js';
import { PrepareOrderDto } from './dto/prepare-order.dto.js';
import { invalidOrderId } from './orders.errors.js';
import { OrdersService } from './orders.service.js';

const AccountIdPipe = new ParseUUIDPipe({ exceptionFactory: invalidAccountId });
const OrderIdPipe = new ParseUUIDPipe({ exceptionFactory: invalidOrderId });

@ApiTags('Mobile - Bons de sortie')
@ApiBearerAuth()
@ApiParam({ name: 'storeId', description: 'Identifiant de la quincaillerie' })
@ApiUnauthorizedResponse({
  description: 'Session absente, expirée ou fermée',
  type: ErrorResponse,
})
@ApiForbiddenResponse({
  description:
    'Membre de la quincaillerie sans le rôle requis (`STORE_ROLE_REQUIRED`)',
  type: ErrorResponse,
})
@ApiNotFoundResponse({
  description:
    'Quincaillerie introuvable : vous n’en êtes pas membre actif ; ou compte, objectif, article ou bon introuvable dans cette quincaillerie',
  type: ErrorResponse,
})
// Every route answers 400 to a malformed store id (StoreAccessGuard). A route
// that declares its own 400 replaces this one, so it names the store id too.
@ApiBadRequestResponse({
  description: 'Identifiant de quincaillerie invalide',
  type: ErrorResponse,
})
@MobileRoute()
@StoreRoles(['MANAGER', 'SELLER'])
@Controller('stores/:storeId')
export class OrdersController {
  constructor(private readonly orders: OrdersService) {}

  /**
   * @description Prepare a material order (bon de sortie) for a customer's account, at today's prices
   * @route POST /api/v1/stores/:storeId/accounts/:accountId/orders
   * @access Store seller or manager (mobile session)
   * @param storeId the store
   * @param accountId the customer's account
   * @body PrepareOrderDto (goalId?, lines [{ articleId, quantity }])
   * @returns 201 OrderView; 404 account, goal or article; 409 STORE_CLOSED, OWN_ACCOUNT, GOAL_CLOSED, ARTICLE_UNAVAILABLE or INSUFFICIENT_BALANCE
   */
  @Post('accounts/:accountId/orders')
  @ApiOperation({
    summary: 'Préparer un bon de sortie',
    description:
      'Le prix du jour, le nom et l’unité de chaque article sont figés sur sa ligne. Le total ne doit pas dépasser ce que contiennent l’objectif choisi (par défaut « Non affecté ») et « Non affecté » ensemble ; rien n’est réservé. Au-delà du seuil de validation de la quincaillerie, le bon d’un vendeur attend la validation du gérant (`AWAITING_VALIDATION`) ; un bon préparé par le gérant est validé par lui. Sinon il attend la confirmation du client (`AWAITING_CUSTOMER`). Aucun argent ne bouge avant cette confirmation. Impossible sur son propre compte ou dans une quincaillerie fermée.',
  })
  @ApiParam({ name: 'accountId', description: 'Identifiant du compte' })
  @ApiCreatedResponse({ description: 'Bon préparé', type: OrderView })
  @ApiBadRequestResponse({
    description:
      'Identifiant de quincaillerie ou de compte invalide ; lignes, quantités ou objectif invalides (`details`)',
    type: ErrorResponse,
  })
  @ApiConflictResponse({
    description:
      'Quincaillerie fermée (`STORE_CLOSED`) ; votre propre compte (`OWN_ACCOUNT`) ; objectif fermé (`GOAL_CLOSED`) ; article retiré de la vente (`ARTICLE_UNAVAILABLE`) ; total supérieur à ce qui est disponible (`INSUFFICIENT_BALANCE`)',
    type: ErrorResponse,
  })
  prepare(
    @CurrentStore() store: CurrentStoreContext,
    @CurrentUser() actor: AuthenticatedUser,
    @Param('accountId', AccountIdPipe) accountId: string,
    @Body() body: PrepareOrderDto,
  ): Promise<OrderView> {
    return this.orders.prepare(store, actor, accountId, body);
  }

  /**
   * @description List the store's material orders, newest first, filtered by status and account
   * @route GET /api/v1/stores/:storeId/orders
   * @access Store seller or manager (mobile session)
   * @param storeId the store
   * @query ListOrdersQueryDto (page, pageSize, status?, accountId?)
   * @returns 200 Paginated<OrderView>
   */
  @Get('orders')
  @ApiOperation({
    summary: 'Bons de sortie de la quincaillerie',
    description:
      'Du plus récent au plus ancien, paginés. Filtres : état (par exemple `AWAITING_VALIDATION` pour les bons à valider) et compte.',
  })
  @ApiPaginatedResponse(OrderView, 'Bons de sortie')
  @ApiBadRequestResponse({
    description:
      'Identifiant de quincaillerie invalide ; filtre ou pagination invalide (`details`)',
    type: ErrorResponse,
  })
  list(
    @CurrentStore() store: CurrentStoreContext,
    @Query() query: ListOrdersQueryDto,
  ): Promise<Paginated<OrderView>> {
    return this.orders.list(store.storeId, query);
  }

  /**
   * @description One material order of the store, with its lines and who did each step
   * @route GET /api/v1/stores/:storeId/orders/:orderId
   * @access Store seller or manager (mobile session)
   * @param storeId the store
   * @param orderId the order
   * @returns 200 OrderView; 404 order not in this store
   */
  @Get('orders/:orderId')
  @ApiOperation({ summary: 'Détail d’un bon de sortie' })
  @ApiParam({ name: 'orderId', description: 'Identifiant du bon' })
  @ApiOkResponse({ description: 'Bon', type: OrderView })
  @ApiBadRequestResponse({
    description: 'Identifiant de quincaillerie ou de bon invalide',
    type: ErrorResponse,
  })
  detail(
    @CurrentStore() store: CurrentStoreContext,
    @Param('orderId', OrderIdPipe) orderId: string,
  ): Promise<OrderView> {
    return this.orders.detail(store.storeId, orderId);
  }

  /**
   * @description The manager validates a seller's order above the threshold: it then awaits the customer
   * @route POST /api/v1/stores/:storeId/orders/:orderId/validate
   * @access Store manager (mobile session)
   * @param storeId the store
   * @param orderId the order
   * @returns 200 OrderView; 409 ORDER_STATUS or STORE_CLOSED
   */
  @Post('orders/:orderId/validate')
  @HttpCode(HttpStatus.OK)
  @StoreRoles(['MANAGER'])
  @ApiOperation({
    summary: 'Valider un bon',
    description:
      'Seulement pour un bon en attente de validation (`AWAITING_VALIDATION`) : il passe en attente de la confirmation du client.',
  })
  @ApiParam({ name: 'orderId', description: 'Identifiant du bon' })
  @ApiOkResponse({ description: 'Bon validé', type: OrderView })
  @ApiBadRequestResponse({
    description: 'Identifiant de quincaillerie ou de bon invalide',
    type: ErrorResponse,
  })
  @ApiConflictResponse({
    description:
      'Le bon n’est pas en attente de validation (`ORDER_STATUS`) ; quincaillerie fermée (`STORE_CLOSED`)',
    type: ErrorResponse,
  })
  validate(
    @CurrentStore() store: CurrentStoreContext,
    @CurrentUser() actor: AuthenticatedUser,
    @Param('orderId', OrderIdPipe) orderId: string,
  ): Promise<OrderView> {
    return this.orders.validate(store, actor, orderId);
  }

  /**
   * @description The manager refuses a seller's order above the threshold, with a reason
   * @route POST /api/v1/stores/:storeId/orders/:orderId/refuse
   * @access Store manager (mobile session)
   * @param storeId the store
   * @param orderId the order
   * @body RefuseOrderDto (reason)
   * @returns 200 OrderView; 409 ORDER_STATUS or STORE_CLOSED
   */
  @Post('orders/:orderId/refuse')
  @HttpCode(HttpStatus.OK)
  @StoreRoles(['MANAGER'])
  @ApiOperation({
    summary: 'Refuser un bon',
    description:
      'Seulement pour un bon en attente de validation : il est refusé (`REFUSED_BY_MANAGER`), avec le motif donné. Le vendeur et le client voient ce motif : rédigez-le pour le client.',
  })
  @ApiParam({ name: 'orderId', description: 'Identifiant du bon' })
  @ApiOkResponse({ description: 'Bon refusé', type: OrderView })
  @ApiBadRequestResponse({
    description:
      'Identifiant de quincaillerie ou de bon invalide ; motif invalide (`details`)',
    type: ErrorResponse,
  })
  @ApiConflictResponse({
    description:
      'Le bon n’est pas en attente de validation (`ORDER_STATUS`) ; quincaillerie fermée (`STORE_CLOSED`)',
    type: ErrorResponse,
  })
  refuse(
    @CurrentStore() store: CurrentStoreContext,
    @CurrentUser() actor: AuthenticatedUser,
    @Param('orderId', OrderIdPipe) orderId: string,
    @Body() body: RefuseOrderDto,
  ): Promise<OrderView> {
    return this.orders.refuse(store, actor, orderId, body);
  }

  /**
   * @description Cancel an order the customer has not confirmed (its preparer or the manager)
   * @route POST /api/v1/stores/:storeId/orders/:orderId/cancel
   * @access Store seller (own orders) or manager (mobile session)
   * @param storeId the store
   * @param orderId the order
   * @body CancelOrderDto (reason?)
   * @returns 200 OrderView; 403 NOT_ORDER_PREPARER; 409 ORDER_STATUS or STORE_CLOSED
   */
  @Post('orders/:orderId/cancel')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Annuler un bon',
    description:
      'Avant la confirmation du client (`AWAITING_VALIDATION` ou `AWAITING_CUSTOMER`). Un vendeur n’annule que les bons qu’il a préparés ; le gérant annule tous les bons. Motif facultatif.',
  })
  @ApiParam({ name: 'orderId', description: 'Identifiant du bon' })
  @ApiOkResponse({ description: 'Bon annulé', type: OrderView })
  @ApiBadRequestResponse({
    description:
      'Identifiant de quincaillerie ou de bon invalide ; motif invalide (`details`)',
    type: ErrorResponse,
  })
  @ApiForbiddenResponse({
    description:
      'Membre sans le rôle requis (`STORE_ROLE_REQUIRED`) ; vendeur qui n’a pas préparé ce bon (`NOT_ORDER_PREPARER`)',
    type: ErrorResponse,
  })
  @ApiConflictResponse({
    description:
      'Le bon n’est plus annulable (`ORDER_STATUS`) ; quincaillerie fermée (`STORE_CLOSED`)',
    type: ErrorResponse,
  })
  cancel(
    @CurrentStore() store: CurrentStoreContext,
    @CurrentUser() actor: AuthenticatedUser,
    @Param('orderId', OrderIdPipe) orderId: string,
    @Body() body: CancelOrderDto,
  ): Promise<OrderView> {
    return this.orders.cancel(store, actor, orderId, body);
  }
}
