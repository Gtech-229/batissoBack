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
import { invalidOperationId } from '../ledger/ledger.errors.js';
import type { AuthenticatedUser } from '../mobile-auth/authenticated-user.js';
import { CurrentUser } from '../mobile-auth/decorators/current-user.decorator.js';
import { MobileRoute } from '../mobile-auth/decorators/mobile-route.decorator.js';
import { invalidDisputeId } from './disputes.errors.js';
import { DisputesService } from './disputes.service.js';
import { DisputeMessageDto } from './dto/dispute-message.dto.js';
import { MyDisputeView } from './dto/dispute-view.js';
import { ListMyDisputesQueryDto } from './dto/list-disputes.dto.js';

const AccountIdPipe = new ParseUUIDPipe({ exceptionFactory: invalidAccountId });
const OperationIdPipe = new ParseUUIDPipe({
  exceptionFactory: invalidOperationId,
});
const DisputeIdPipe = new ParseUUIDPipe({ exceptionFactory: invalidDisputeId });

@ApiTags('Mobile - Mes contestations')
@ApiBearerAuth()
@ApiParam({ name: 'accountId', description: 'Identifiant de mon compte' })
@ApiUnauthorizedResponse({
  description: 'Session absente, expirée ou fermée',
  type: ErrorResponse,
})
@ApiNotFoundResponse({
  description:
    'Compte introuvable parmi les vôtres, ou opération ou contestation introuvable sur ce compte',
  type: ErrorResponse,
})
@MobileRoute()
@Controller('me/accounts/:accountId')
export class MyDisputesController {
  constructor(private readonly disputes: DisputesService) {}

  /**
   * @description Dispute an operation of one of the user's accounts, with a first message to the store
   * @route POST /api/v1/me/accounts/:accountId/operations/:operationId/disputes
   * @access Mobile session (Bearer), the account's customer only
   * @param accountId one of the user's accounts
   * @param operationId the operation disputed (deposit, purchase, or correction)
   * @body DisputeMessageDto (message)
   * @returns 201 MyDisputeView; 404 operation not on this account; 409 DISPUTE_ALREADY_OPEN
   */
  @Post('operations/:operationId/disputes')
  @ApiOperation({
    summary: 'Contester une opération',
    description:
      'Ouvre une contestation sur une opération de votre compte (dépôt, achat ou correction), avec un premier message à la quincaillerie, dont le gérant est prévenu. La contestation ne change jamais l’opération : une correction éventuelle est faite par le gérant. Une seule contestation en cours par opération.',
  })
  @ApiParam({
    name: 'operationId',
    description: 'Identifiant de l’opération contestée',
  })
  @ApiCreatedResponse({
    description: 'Contestation ouverte',
    type: MyDisputeView,
  })
  @ApiBadRequestResponse({
    description:
      'Identifiant de compte ou d’opération invalide ; message invalide (`details`)',
    type: ErrorResponse,
  })
  @ApiConflictResponse({
    description:
      'Une contestation est déjà en cours sur cette opération (`DISPUTE_ALREADY_OPEN`)',
    type: ErrorResponse,
  })
  open(
    @CurrentUser() user: AuthenticatedUser,
    @Param('accountId', AccountIdPipe) accountId: string,
    @Param('operationId', OperationIdPipe) operationId: string,
    @Body() body: DisputeMessageDto,
  ): Promise<MyDisputeView> {
    return this.disputes.openMine(user, accountId, operationId, body);
  }

  /**
   * @description List the disputes of one of the user's accounts, newest first
   * @route GET /api/v1/me/accounts/:accountId/disputes
   * @access Mobile session (Bearer), the account's customer only
   * @param accountId one of the user's accounts
   * @query ListMyDisputesQueryDto (page, pageSize, status?)
   * @returns 200 Paginated<MyDisputeView>
   */
  @Get('disputes')
  @ApiOperation({
    summary: 'Mes contestations',
    description:
      'Les contestations de ce compte, de la plus récente à la plus ancienne, paginées, avec leurs messages.',
  })
  @ApiPaginatedResponse(MyDisputeView, 'Mes contestations')
  @ApiBadRequestResponse({
    description:
      'Identifiant de compte invalide ; filtre ou pagination invalide (`details`)',
    type: ErrorResponse,
  })
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Param('accountId', AccountIdPipe) accountId: string,
    @Query() query: ListMyDisputesQueryDto,
  ): Promise<Paginated<MyDisputeView>> {
    return this.disputes.listMine(user, accountId, query);
  }

  /**
   * @description One dispute of one of the user's accounts, with its thread
   * @route GET /api/v1/me/accounts/:accountId/disputes/:disputeId
   * @access Mobile session (Bearer), the account's customer only
   * @param accountId one of the user's accounts
   * @param disputeId the dispute
   * @returns 200 MyDisputeView
   */
  @Get('disputes/:disputeId')
  @ApiOperation({ summary: 'Détail d’une de mes contestations' })
  @ApiParam({
    name: 'disputeId',
    description: 'Identifiant de la contestation',
  })
  @ApiOkResponse({ description: 'Contestation', type: MyDisputeView })
  @ApiBadRequestResponse({
    description: 'Identifiant de compte ou de contestation invalide',
    type: ErrorResponse,
  })
  detail(
    @CurrentUser() user: AuthenticatedUser,
    @Param('accountId', AccountIdPipe) accountId: string,
    @Param('disputeId', DisputeIdPipe) disputeId: string,
  ): Promise<MyDisputeView> {
    return this.disputes.detailMine(user, accountId, disputeId);
  }

  /**
   * @description Write again in one of the user's disputes: it then awaits the store again
   * @route POST /api/v1/me/accounts/:accountId/disputes/:disputeId/messages
   * @access Mobile session (Bearer), the account's customer only
   * @param accountId one of the user's accounts
   * @param disputeId the dispute, not closed
   * @body DisputeMessageDto (message)
   * @returns 201 MyDisputeView; 409 DISPUTE_STATUS
   */
  @Post('disputes/:disputeId/messages')
  @ApiOperation({
    summary: 'Écrire dans une de mes contestations',
    description:
      'Ajoute votre message au fil de la contestation, par exemple si la réponse de la quincaillerie ne vous convient pas. La contestation repasse à `OPEN` : en attente de la quincaillerie, dont le gérant est prévenu. Impossible sur une contestation close.',
  })
  @ApiParam({
    name: 'disputeId',
    description: 'Identifiant de la contestation',
  })
  @ApiCreatedResponse({ description: 'Message envoyé', type: MyDisputeView })
  @ApiBadRequestResponse({
    description:
      'Identifiant de compte ou de contestation invalide ; message invalide (`details`)',
    type: ErrorResponse,
  })
  @ApiConflictResponse({
    description: 'Contestation close (`DISPUTE_STATUS`)',
    type: ErrorResponse,
  })
  write(
    @CurrentUser() user: AuthenticatedUser,
    @Param('accountId', AccountIdPipe) accountId: string,
    @Param('disputeId', DisputeIdPipe) disputeId: string,
    @Body() body: DisputeMessageDto,
  ): Promise<MyDisputeView> {
    return this.disputes.writeMine(user, accountId, disputeId, body);
  }

  /**
   * @description Close one of the user's disputes: the answer is accepted, or the dispute withdrawn
   * @route POST /api/v1/me/accounts/:accountId/disputes/:disputeId/close
   * @access Mobile session (Bearer), the account's customer only
   * @param accountId one of the user's accounts
   * @param disputeId the dispute, not closed
   * @returns 200 MyDisputeView; 409 DISPUTE_STATUS
   */
  @Post('disputes/:disputeId/close')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Clore une de mes contestations',
    description:
      'Vous acceptez la réponse de la quincaillerie, ou vous retirez votre contestation : elle passe à `CLOSED` et le gérant est prévenu. C’est définitif ; si vous êtes de nouveau en désaccord, ouvrez une nouvelle contestation sur l’opération.',
  })
  @ApiParam({
    name: 'disputeId',
    description: 'Identifiant de la contestation',
  })
  @ApiOkResponse({ description: 'Contestation close', type: MyDisputeView })
  @ApiBadRequestResponse({
    description: 'Identifiant de compte ou de contestation invalide',
    type: ErrorResponse,
  })
  @ApiConflictResponse({
    description: 'Contestation déjà close (`DISPUTE_STATUS`)',
    type: ErrorResponse,
  })
  close(
    @CurrentUser() user: AuthenticatedUser,
    @Param('accountId', AccountIdPipe) accountId: string,
    @Param('disputeId', DisputeIdPipe) disputeId: string,
  ): Promise<MyDisputeView> {
    return this.disputes.closeMine(user, accountId, disputeId);
  }
}
