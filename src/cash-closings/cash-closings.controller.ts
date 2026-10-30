import {
  Body,
  Controller,
  Get,
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
import type { Response } from 'express';
import { ErrorResponse } from '../common/errors/error-response.js';
import {
  ApiPaginatedResponse,
  PaginationQueryDto,
  type Paginated,
} from '../common/pagination.js';
import { IdempotencyKey } from '../ledger/idempotency-key.decorator.js';
import { IDEMPOTENCY_KEY_RULE } from '../ledger/ledger.errors.js';
import type { AuthenticatedUser } from '../mobile-auth/authenticated-user.js';
import { CurrentUser } from '../mobile-auth/decorators/current-user.decorator.js';
import { MobileRoute } from '../mobile-auth/decorators/mobile-route.decorator.js';
import type { CurrentStoreContext } from '../store-access/current-store.js';
import { CurrentStore } from '../store-access/decorators/current-store.decorator.js';
import { StoreRoles } from '../store-access/decorators/store-roles.decorator.js';
import { invalidClosingId } from './cash-closings.errors.js';
import { CashClosingsService } from './cash-closings.service.js';
import { CashClosingView, PendingCashView } from './dto/cash-closing-view.js';
import { CloseCashDto } from './dto/close-cash.dto.js';

const ClosingIdPipe = new ParseUUIDPipe({ exceptionFactory: invalidClosingId });

@ApiTags('Mobile - Clôture de caisse')
@ApiBearerAuth()
@ApiParam({ name: 'storeId', description: 'Identifiant de la quincaillerie' })
@ApiUnauthorizedResponse({
  description: 'Session absente, expirée ou fermée',
  type: ErrorResponse,
})
@ApiForbiddenResponse({
  description:
    'Membre de la quincaillerie qui n’en est pas le gérant (`STORE_ROLE_REQUIRED`)',
  type: ErrorResponse,
})
@ApiNotFoundResponse({
  description:
    'Quincaillerie introuvable : vous n’en êtes pas membre actif ; ou clôture introuvable dans cette quincaillerie',
  type: ErrorResponse,
})
@MobileRoute()
@StoreRoles(['MANAGER'])
@Controller('stores/:storeId/cash-closings')
export class CashClosingsController {
  constructor(private readonly closings: CashClosingsService) {}

  /**
   * @description What should be in the cash drawer now: the deposits and corrections since the last closing
   * @route GET /api/v1/stores/:storeId/cash-closings/pending
   * @access Store manager (mobile session)
   * @param storeId the store
   * @returns 200 PendingCashView
   */
  @Get('pending')
  @ApiOperation({
    summary: 'Montant attendu en caisse',
    description:
      'Avant de compter : les dépôts en espèces et les corrections de dépôts depuis la dernière clôture, et le montant attendu (les dépôts moins les corrections). Les achats et les recrédits n’en font pas partie : ils ne font pas entrer d’espèces.',
  })
  @ApiOkResponse({ description: 'Montant attendu', type: PendingCashView })
  @ApiBadRequestResponse({
    description: 'Identifiant de quincaillerie invalide',
    type: ErrorResponse,
  })
  pending(
    @CurrentStore() store: CurrentStoreContext,
  ): Promise<PendingCashView> {
    return this.closings.pending(store.storeId);
  }

  /**
   * @description List the store's cash closings, newest first
   * @route GET /api/v1/stores/:storeId/cash-closings
   * @access Store manager (mobile session)
   * @param storeId the store
   * @query PaginationQueryDto (page, pageSize)
   * @returns 200 Paginated<CashClosingView>
   */
  @Get()
  @ApiOperation({
    summary: 'Clôtures de caisse',
    description:
      'Les clôtures de la quincaillerie, de la plus récente à la plus ancienne, paginées.',
  })
  @ApiPaginatedResponse(CashClosingView, 'Clôtures de caisse')
  @ApiBadRequestResponse({
    description:
      'Identifiant de quincaillerie invalide ; pagination invalide (`details`)',
    type: ErrorResponse,
  })
  list(
    @CurrentStore() store: CurrentStoreContext,
    @Query() query: PaginationQueryDto,
  ): Promise<Paginated<CashClosingView>> {
    return this.closings.list(store.storeId, query);
  }

  /**
   * @description One cash closing of the store
   * @route GET /api/v1/stores/:storeId/cash-closings/:closingId
   * @access Store manager (mobile session)
   * @param storeId the store
   * @param closingId the closing
   * @returns 200 CashClosingView
   */
  @Get(':closingId')
  @ApiOperation({ summary: 'Détail d’une clôture de caisse' })
  @ApiParam({ name: 'closingId', description: 'Identifiant de la clôture' })
  @ApiOkResponse({ description: 'Clôture', type: CashClosingView })
  @ApiBadRequestResponse({
    description: 'Identifiant de quincaillerie ou de clôture invalide',
    type: ErrorResponse,
  })
  detail(
    @CurrentStore() store: CurrentStoreContext,
    @Param('closingId', ClosingIdPipe) closingId: string,
  ): Promise<CashClosingView> {
    return this.closings.detail(store.storeId, closingId);
  }

  /**
   * @description Close the cash: the manager records the counted amount against what should be there
   * @route POST /api/v1/stores/:storeId/cash-closings
   * @access Store manager (mobile session)
   * @param storeId the store
   * @header Idempotency-Key a UUID generated by the app for this request
   * @body CloseCashDto (countedTotal, justification?)
   * @returns 201 CashClosingView (200 when the key already made this closing); 409 JUSTIFICATION_REQUIRED or IDEMPOTENCY_KEY_REUSED
   */
  @Post()
  @ApiOperation({
    summary: 'Clôturer la caisse',
    description:
      'Enregistre le montant compté face au montant attendu, pour tout ce qui s’est passé depuis la dernière clôture. Une justification est requise dès qu’il y a un écart. Une clôture ne déplace aucun argent et ne peut plus être modifiée : une erreur de comptage s’explique dans la clôture suivante. Possible quel que soit le statut de la quincaillerie.',
  })
  @ApiHeader({
    name: 'Idempotency-Key',
    required: true,
    description: IDEMPOTENCY_KEY_RULE,
  })
  @ApiCreatedResponse({ description: 'Caisse clôturée', type: CashClosingView })
  @ApiOkResponse({
    description:
      'Demande répétée avec la même clé : cette clôture était déjà faite, elle est renvoyée et rien n’est enregistré de nouveau',
    type: CashClosingView,
  })
  @ApiBadRequestResponse({
    description:
      'Identifiant de quincaillerie invalide ; montant ou justification invalide ; en-tête Idempotency-Key absent ou invalide (`details`)',
    type: ErrorResponse,
  })
  @ApiConflictResponse({
    description:
      'Écart sans justification (`JUSTIFICATION_REQUIRED`, le message donne le montant attendu et l’écart) ; clé déjà utilisée pour une autre clôture (`IDEMPOTENCY_KEY_REUSED`)',
    type: ErrorResponse,
  })
  async close(
    @CurrentStore() store: CurrentStoreContext,
    @CurrentUser() actor: AuthenticatedUser,
    @IdempotencyKey() idempotencyKey: string,
    @Body() body: CloseCashDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<CashClosingView> {
    const { closing, replayed } = await this.closings.close(
      store,
      actor,
      body,
      idempotencyKey,
    );
    res.status(replayed ? HttpStatus.OK : HttpStatus.CREATED);
    return closing;
  }
}
