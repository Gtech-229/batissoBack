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
import {
  ApiPaginatedResponse,
  PaginationQueryDto,
  type Paginated,
} from '../common/pagination.js';
import type { AuthenticatedUser } from '../mobile-auth/authenticated-user.js';
import { CurrentUser } from '../mobile-auth/decorators/current-user.decorator.js';
import { MobileRoute } from '../mobile-auth/decorators/mobile-route.decorator.js';
import { OperationReceipt } from './dto/operation-receipt.js';
import { invalidOperationId } from './ledger.errors.js';
import { LedgerService } from './ledger.service.js';

const AccountIdPipe = new ParseUUIDPipe({ exceptionFactory: invalidAccountId });
const OperationIdPipe = new ParseUUIDPipe({
  exceptionFactory: invalidOperationId,
});

@ApiTags('Mobile - Mon compte')
@ApiBearerAuth()
@ApiParam({ name: 'accountId', description: 'Identifiant de mon compte' })
@ApiUnauthorizedResponse({
  description: 'Session absente, expirée ou fermée',
  type: ErrorResponse,
})
@ApiNotFoundResponse({
  description:
    'Compte introuvable parmi les vôtres, ou opération introuvable sur ce compte',
  type: ErrorResponse,
})
@MobileRoute()
@Controller('me/accounts/:accountId/operations')
export class MyOperationsController {
  constructor(private readonly ledger: LedgerService) {}

  /**
   * @description List the operations of one of the signed-in user's own accounts, newest first
   * @route GET /api/v1/me/accounts/:accountId/operations
   * @access Mobile session (Bearer), the account's customer only
   * @param accountId one of the user's accounts
   * @query PaginationQueryDto (page, pageSize)
   * @returns 200 Paginated<OperationReceipt>; 404 not one of the user's accounts
   */
  @Get()
  @ApiOperation({
    summary: 'Historique de mon compte',
    description:
      'Les opérations de l’un de mes comptes, de la plus récente à la plus ancienne, chacune sous forme de reçu.',
  })
  @ApiPaginatedResponse(OperationReceipt, 'Page de l’historique')
  @ApiBadRequestResponse({
    description:
      'Identifiant de compte invalide ; pagination invalide (`details`)',
    type: ErrorResponse,
  })
  history(
    @CurrentUser() user: AuthenticatedUser,
    @Param('accountId', AccountIdPipe) accountId: string,
    @Query() query: PaginationQueryDto,
  ): Promise<Paginated<OperationReceipt>> {
    return this.ledger.myHistory(user.userId, accountId, query);
  }

  /**
   * @description Read the receipt of one operation of the signed-in user's own account
   * @route GET /api/v1/me/accounts/:accountId/operations/:operationId
   * @access Mobile session (Bearer), the account's customer only
   * @param accountId one of the user's accounts
   * @param operationId the operation
   * @returns 200 OperationReceipt; 404 not the user's operation
   */
  @Get(':operationId')
  @ApiOperation({
    summary: 'Reçu d’une de mes opérations',
    description:
      'Référence, montant, solde avant et après, objectif, compte, quincaillerie, auteur et date.',
  })
  @ApiParam({ name: 'operationId', description: 'Identifiant de l’opération' })
  @ApiOkResponse({ description: 'Reçu', type: OperationReceipt })
  @ApiBadRequestResponse({
    description: 'Identifiant de compte ou d’opération invalide',
    type: ErrorResponse,
  })
  receipt(
    @CurrentUser() user: AuthenticatedUser,
    @Param('accountId', AccountIdPipe) accountId: string,
    @Param('operationId', OperationIdPipe) operationId: string,
  ): Promise<OperationReceipt> {
    return this.ledger.myReceipt(user.userId, accountId, operationId);
  }
}
