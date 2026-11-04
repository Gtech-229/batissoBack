import { Controller, Get, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiCookieAuth,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { RequirePermission } from '../admin-auth/decorators/require-permission.decorator.js';
import { ErrorResponse } from '../common/errors/error-response.js';
import { ApiPaginatedResponse, type Paginated } from '../common/pagination.js';
import { invalidDisputeId } from './disputes.errors.js';
import { DisputesService } from './disputes.service.js';
import { DisputeView } from './dto/dispute-view.js';
import { AdminDisputesQueryDto } from './dto/list-disputes.dto.js';

const DisputeIdPipe = new ParseUUIDPipe({ exceptionFactory: invalidDisputeId });

@ApiTags('Administration - Contestations')
@ApiCookieAuth()
@ApiUnauthorizedResponse({ description: 'Non connecté', type: ErrorResponse })
@ApiForbiddenResponse({
  description: 'Permission manquante',
  type: ErrorResponse,
})
@RequirePermission('disputes.read')
@Controller('admin/disputes')
export class AdminDisputesController {
  constructor(private readonly disputes: DisputesService) {}

  /**
   * @description List the disputes still awaiting an answer, in every store, newest first
   * @route GET /api/v1/admin/disputes
   * @access Admin with disputes.read
   * @query status (OPEN | ANSWERED), storeId, page, pageSize
   * @returns Paginated DisputeView, with the thread
   */
  @Get()
  @ApiOperation({
    summary: 'Contestations en cours',
    description:
      'Les contestations de toutes les quincailleries encore en attente : OPEN (de la quincaillerie) ou ANSWERED (du client), les plus récentes d’abord, avec leurs messages. Lecture seule : un administrateur ne répond pas et ne clôt pas. Les personnes sont nommées, sans téléphone.',
  })
  @ApiPaginatedResponse(DisputeView, 'Page de contestations')
  @ApiBadRequestResponse({
    description: 'Filtre invalide (`details`)',
    type: ErrorResponse,
  })
  list(@Query() query: AdminDisputesQueryDto): Promise<Paginated<DisputeView>> {
    return this.disputes.listUnresolved(query);
  }

  /**
   * @description One dispute still awaiting an answer, with its thread
   * @route GET /api/v1/admin/disputes/:disputeId
   * @access Admin with disputes.read
   * @param disputeId (UUID) dispute id
   * @returns DisputeView; 404 unknown or closed
   */
  @Get(':disputeId')
  @ApiOperation({
    summary: 'Détail d’une contestation en cours',
    description:
      'La contestation, l’opération contestée et tous les messages. Une contestation close répond 404, comme un identifiant inconnu.',
  })
  @ApiParam({
    name: 'disputeId',
    description: 'Identifiant de la contestation',
  })
  @ApiOkResponse({ description: 'Contestation', type: DisputeView })
  @ApiBadRequestResponse({
    description: 'Identifiant invalide',
    type: ErrorResponse,
  })
  @ApiNotFoundResponse({
    description: 'Contestation introuvable ou close',
    type: ErrorResponse,
  })
  detail(
    @Param('disputeId', DisputeIdPipe) disputeId: string,
  ): Promise<DisputeView> {
    return this.disputes.detailUnresolved(disputeId);
  }
}
