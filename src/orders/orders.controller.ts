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
  Res,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiHeader,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { invalidAccountId } from '../accounts/accounts.errors.js';
import type { Response } from 'express';
import { ErrorResponse } from '../common/errors/error-response.js';
import { IdempotencyKey } from '../ledger/idempotency-key.decorator.js';
import { IDEMPOTENCY_KEY_RULE } from '../ledger/ledger.errors.js';
import { ApiPaginatedResponse, type Paginated } from '../common/pagination.js';
import type { AuthenticatedUser } from '../mobile-auth/authenticated-user.js';
import { CurrentUser } from '../mobile-auth/decorators/current-user.decorator.js';
import { MobileRoute } from '../mobile-auth/decorators/mobile-route.decorator.js';
import type { CurrentStoreContext } from '../store-access/current-store.js';
import { CurrentStore } from '../store-access/decorators/current-store.decorator.js';
import { StoreRoles } from '../store-access/decorators/store-roles.decorator.js';
import { ConfirmationCodesService } from './confirmation-codes.service.js';
import { ListOrdersQueryDto } from './dto/list-orders.dto.js';
import {
  ConfirmByCodeDto,
  ConfirmationCodeSent,
} from './dto/order-confirmation.dto.js';
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
  constructor(
    private readonly orders: OrdersService,
    private readonly codes: ConfirmationCodesService,
  ) {}

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

  /**
   * @description Mark a confirmed (debited) order as handed over to the customer, always in full
   * @route POST /api/v1/stores/:storeId/orders/:orderId/deliver
   * @access Store seller or manager (mobile session)
   * @param storeId the store
   * @param orderId the order, confirmed by the customer
   * @returns 200 OrderView; 409 ORDER_STATUS
   */
  @Post('orders/:orderId/deliver')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Marquer un bon comme livré',
    description:
      'Seulement pour un bon confirmé par le client (`CONFIRMED`, déjà débité) : il passe à `DELIVERED`, avec la date de livraison et le membre de l’équipe qui l’a livré. Un bon est toujours livré en entier. Tout vendeur ou le gérant peut le livrer, même dans une quincaillerie fermée : le client a déjà payé.',
  })
  @ApiParam({ name: 'orderId', description: 'Identifiant du bon' })
  @ApiOkResponse({ description: 'Bon livré', type: OrderView })
  @ApiBadRequestResponse({
    description: 'Identifiant de quincaillerie ou de bon invalide',
    type: ErrorResponse,
  })
  @ApiConflictResponse({
    description:
      'Le bon n’est pas confirmé par le client, ou il est déjà livré (`ORDER_STATUS`)',
    type: ErrorResponse,
  })
  deliver(
    @CurrentStore() store: CurrentStoreContext,
    @CurrentUser() actor: AuthenticatedUser,
    @Param('orderId', OrderIdPipe) orderId: string,
  ): Promise<OrderView> {
    return this.orders.deliver(store, actor, orderId);
  }

  /**
   * @description Text the customer a one-time code to confirm this order at the counter (customers without the app)
   * @route POST /api/v1/stores/:storeId/orders/:orderId/confirmation-code
   * @access Store seller or manager (mobile session)
   * @param storeId the store
   * @param orderId the order, awaiting the customer
   * @returns 201 ConfirmationCodeSent; 409 ORDER_STATUS, CODE_COOLDOWN, CODE_LIMIT or STORE_CLOSED
   */
  @Post('orders/:orderId/confirmation-code')
  @ApiOperation({
    summary: 'Envoyer un code de confirmation au client',
    description:
      'Pour un client sans l’application : un code à 6 chiffres lui est envoyé par SMS, avec le numéro du bon, le montant et la quincaillerie. Il le lit au vendeur, qui le saisit (`POST .../confirm`). Le code ne vaut que pour ce bon, pendant 10 minutes ; seul le dernier code envoyé fonctionne. Au moins 1 minute entre deux codes, 5 codes au plus par bon.',
  })
  @ApiParam({ name: 'orderId', description: 'Identifiant du bon' })
  @ApiCreatedResponse({
    description: 'Code envoyé',
    type: ConfirmationCodeSent,
  })
  @ApiBadRequestResponse({
    description: 'Identifiant de quincaillerie ou de bon invalide',
    type: ErrorResponse,
  })
  @ApiConflictResponse({
    description:
      'Le bon n’attend pas la confirmation du client (`ORDER_STATUS`) ; code envoyé il y a moins d’une minute (`CODE_COOLDOWN`) ; nombre maximal de codes atteint (`CODE_LIMIT`) ; quincaillerie fermée (`STORE_CLOSED`)',
    type: ErrorResponse,
  })
  requestCode(
    @CurrentStore() store: CurrentStoreContext,
    @CurrentUser() actor: AuthenticatedUser,
    @Param('orderId', OrderIdPipe) orderId: string,
  ): Promise<ConfirmationCodeSent> {
    return this.codes.request(store, actor, orderId);
  }

  /**
   * @description Confirm an order with the code the customer received by SMS: the account is debited
   * @route POST /api/v1/stores/:storeId/orders/:orderId/confirm
   * @access Store seller or manager (mobile session)
   * @param storeId the store
   * @param orderId the order, awaiting the customer
   * @header Idempotency-Key a UUID generated by the app for this request
   * @body ConfirmByCodeDto (code)
   * @returns 201 OrderView (200 when the key already confirmed this order); 400 INVALID_CODE; 409 ORDER_STATUS, STORE_CLOSED, GOAL_CLOSED, INSUFFICIENT_BALANCE or IDEMPOTENCY_KEY_REUSED
   */
  @Post('orders/:orderId/confirm')
  @ApiOperation({
    summary: 'Confirmer un bon avec le code du client',
    description:
      'Le vendeur saisit le code que le client a reçu par SMS. Avec le bon code, encore valable, le montant est débité du compte du client : de l’objectif du bon, puis de « Non affecté » pour le reste ; le bon passe à `CONFIRMED` (`confirmedVia: SMS_CODE`). Code faux, expiré ou remplacé : `INVALID_CODE` ; après 5 codes faux, il faut en demander un nouveau.',
  })
  @ApiParam({ name: 'orderId', description: 'Identifiant du bon' })
  @ApiHeader({
    name: 'Idempotency-Key',
    required: true,
    description: IDEMPOTENCY_KEY_RULE,
  })
  @ApiCreatedResponse({
    description: 'Bon confirmé et débité',
    type: OrderView,
  })
  @ApiOkResponse({
    description:
      'Cette clé a déjà confirmé ce bon : le bon, rien n’est débité à nouveau',
    type: OrderView,
  })
  @ApiBadRequestResponse({
    description:
      'Identifiant invalide ; code faux, expiré ou remplacé (`INVALID_CODE`) ou mal formé ; en-tête Idempotency-Key absent ou invalide (`details`)',
    type: ErrorResponse,
  })
  @ApiConflictResponse({
    description:
      'Le bon n’attend pas la confirmation du client (`ORDER_STATUS`) ; quincaillerie fermée (`STORE_CLOSED`) ; objectif fermé (`GOAL_CLOSED`) ; solde insuffisant (`INSUFFICIENT_BALANCE`) ; clé déjà utilisée pour une autre opération (`IDEMPOTENCY_KEY_REUSED`)',
    type: ErrorResponse,
  })
  async confirmWithCode(
    @CurrentStore() store: CurrentStoreContext,
    @CurrentUser() actor: AuthenticatedUser,
    @Param('orderId', OrderIdPipe) orderId: string,
    @IdempotencyKey() idempotencyKey: string,
    @Body() body: ConfirmByCodeDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<OrderView> {
    const { replayed } = await this.codes.confirm(
      store,
      actor,
      orderId,
      body.code,
      idempotencyKey,
    );
    res.status(replayed ? HttpStatus.OK : HttpStatus.CREATED);
    return this.orders.detail(store.storeId, orderId);
  }
}
