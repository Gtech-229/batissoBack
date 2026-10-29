import {
  Body,
  Controller,
  Get,
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
import { ErrorResponse } from '../common/errors/error-response.js';
import { ApiPaginatedResponse, type Paginated } from '../common/pagination.js';
import type { AuthenticatedUser } from '../mobile-auth/authenticated-user.js';
import { CurrentUser } from '../mobile-auth/decorators/current-user.decorator.js';
import { MobileRoute } from '../mobile-auth/decorators/mobile-route.decorator.js';
import type { CurrentStoreContext } from '../store-access/current-store.js';
import { CurrentStore } from '../store-access/decorators/current-store.decorator.js';
import { StoreRoles } from '../store-access/decorators/store-roles.decorator.js';
import { invalidDisputeId } from './disputes.errors.js';
import { DisputesService } from './disputes.service.js';
import { DisputeMessageDto } from './dto/dispute-message.dto.js';
import { DisputeView } from './dto/dispute-view.js';
import { ListDisputesQueryDto } from './dto/list-disputes.dto.js';

const DisputeIdPipe = new ParseUUIDPipe({ exceptionFactory: invalidDisputeId });

@ApiTags('Mobile - Contestations')
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
    'Quincaillerie introuvable : vous n’en êtes pas membre actif ; ou contestation introuvable dans cette quincaillerie',
  type: ErrorResponse,
})
@MobileRoute()
@StoreRoles(['MANAGER'])
@Controller('stores/:storeId/disputes')
export class DisputesController {
  constructor(private readonly disputes: DisputesService) {}

  /**
   * @description List the store's disputes, newest first
   * @route GET /api/v1/stores/:storeId/disputes
   * @access Store manager (mobile session)
   * @param storeId the store
   * @query ListDisputesQueryDto (page, pageSize, status?, accountId?)
   * @returns 200 Paginated<DisputeView>
   */
  @Get()
  @ApiOperation({
    summary: 'Contestations de la quincaillerie',
    description:
      'Les contestations des clients, de la plus récente à la plus ancienne, paginées, avec leurs messages. Filtres : état (`OPEN` : à traiter) et compte.',
  })
  @ApiPaginatedResponse(DisputeView, 'Contestations')
  @ApiBadRequestResponse({
    description:
      'Identifiant de quincaillerie invalide ; filtre ou pagination invalide (`details`)',
    type: ErrorResponse,
  })
  list(
    @CurrentStore() store: CurrentStoreContext,
    @Query() query: ListDisputesQueryDto,
  ): Promise<Paginated<DisputeView>> {
    return this.disputes.list(store.storeId, query);
  }

  /**
   * @description One dispute of the store, with its thread
   * @route GET /api/v1/stores/:storeId/disputes/:disputeId
   * @access Store manager (mobile session)
   * @param storeId the store
   * @param disputeId the dispute
   * @returns 200 DisputeView
   */
  @Get(':disputeId')
  @ApiOperation({ summary: 'Détail d’une contestation' })
  @ApiParam({
    name: 'disputeId',
    description: 'Identifiant de la contestation',
  })
  @ApiOkResponse({ description: 'Contestation', type: DisputeView })
  @ApiBadRequestResponse({
    description: 'Identifiant de quincaillerie ou de contestation invalide',
    type: ErrorResponse,
  })
  detail(
    @CurrentStore() store: CurrentStoreContext,
    @Param('disputeId', DisputeIdPipe) disputeId: string,
  ): Promise<DisputeView> {
    return this.disputes.detail(store.storeId, disputeId);
  }

  /**
   * @description The manager replies in a dispute: it then awaits the customer
   * @route POST /api/v1/stores/:storeId/disputes/:disputeId/messages
   * @access Store manager (mobile session)
   * @param storeId the store
   * @param disputeId the dispute, not closed
   * @body DisputeMessageDto (message)
   * @returns 201 DisputeView; 409 DISPUTE_STATUS
   */
  @Post(':disputeId/messages')
  @ApiOperation({
    summary: 'Répondre à une contestation',
    description:
      'Ajoute votre message au fil de la contestation, que le client voit au nom de la quincaillerie (sans votre nom). La contestation passe à `ANSWERED` : en attente du client, qui peut répondre ou la clore. Une réponse ne change jamais l’opération : une correction se fait à part. Impossible sur une contestation close.',
  })
  @ApiParam({
    name: 'disputeId',
    description: 'Identifiant de la contestation',
  })
  @ApiCreatedResponse({ description: 'Réponse envoyée', type: DisputeView })
  @ApiBadRequestResponse({
    description:
      'Identifiant de quincaillerie ou de contestation invalide ; message invalide (`details`)',
    type: ErrorResponse,
  })
  @ApiConflictResponse({
    description: 'Contestation close (`DISPUTE_STATUS`)',
    type: ErrorResponse,
  })
  reply(
    @CurrentStore() store: CurrentStoreContext,
    @CurrentUser() actor: AuthenticatedUser,
    @Param('disputeId', DisputeIdPipe) disputeId: string,
    @Body() body: DisputeMessageDto,
  ): Promise<DisputeView> {
    return this.disputes.reply(store, actor, disputeId, body);
  }
}
