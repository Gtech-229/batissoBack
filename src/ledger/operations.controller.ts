import { Controller, Get, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
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
import {
  ApiPaginatedResponse,
  PaginationQueryDto,
  type Paginated,
} from '../common/pagination.js';
import { MobileRoute } from '../mobile-auth/decorators/mobile-route.decorator.js';
import type { CurrentStoreContext } from '../store-access/current-store.js';
import { CurrentStore } from '../store-access/decorators/current-store.decorator.js';
import { StoreRoles } from '../store-access/decorators/store-roles.decorator.js';
import { OperationReceipt } from './dto/operation-receipt.js';
import { invalidOperationId } from './ledger.errors.js';
import { LedgerService } from './ledger.service.js';

const AccountIdPipe = new ParseUUIDPipe({ exceptionFactory: invalidAccountId });
const OperationIdPipe = new ParseUUIDPipe({
  exceptionFactory: invalidOperationId,
});

@ApiTags('Mobile - Dépôts et historique')
@ApiBearerAuth()
@ApiParam({ name: 'storeId', description: 'Identifiant de la quincaillerie' })
@ApiParam({ name: 'accountId', description: 'Identifiant du compte' })
@ApiUnauthorizedResponse({
  description: 'Session absente, expirée ou fermée',
  type: ErrorResponse,
})
@ApiForbiddenResponse({
  description:
    'Membre de la quincaillerie sans le rôle de vendeur ou de gérant (`STORE_ROLE_REQUIRED`)',
  type: ErrorResponse,
})
@ApiNotFoundResponse({
  description:
    'Quincaillerie introuvable : vous n’en êtes pas membre actif ; compte introuvable dans cette quincaillerie ; ou opération introuvable sur ce compte',
  type: ErrorResponse,
})
@MobileRoute()
@StoreRoles(['MANAGER', 'SELLER'])
@Controller('stores/:storeId/accounts/:accountId/operations')
export class OperationsController {
  constructor(private readonly ledger: LedgerService) {}

  /**
   * @description List an account's operations, newest first, as receipts
   * @route GET /api/v1/stores/:storeId/accounts/:accountId/operations
   * @access Store seller or manager (mobile session)
   * @param storeId the store
   * @param accountId the account
   * @query PaginationQueryDto (page, pageSize)
   * @returns 200 Paginated<OperationReceipt>
   */
  @Get()
  @ApiOperation({
    summary: 'Historique d’un compte',
    description:
      'Les opérations du compte, de la plus récente à la plus ancienne, chacune sous forme de reçu. Lisible quel que soit le statut de la quincaillerie.',
  })
  @ApiPaginatedResponse(OperationReceipt, 'Page de l’historique')
  @ApiBadRequestResponse({
    description:
      'Identifiant de quincaillerie ou de compte invalide ; pagination invalide (`details`)',
    type: ErrorResponse,
  })
  history(
    @CurrentStore() store: CurrentStoreContext,
    @Param('accountId', AccountIdPipe) accountId: string,
    @Query() query: PaginationQueryDto,
  ): Promise<Paginated<OperationReceipt>> {
    return this.ledger.history(store.storeId, accountId, query);
  }

  /**
   * @description Read the receipt of one operation of the account
   * @route GET /api/v1/stores/:storeId/accounts/:accountId/operations/:operationId
   * @access Store seller or manager (mobile session)
   * @param storeId the store
   * @param accountId the account
   * @param operationId the operation
   * @returns 200 OperationReceipt; 404 operation not on this account
   */
  @Get(':operationId')
  @ApiOperation({
    summary: 'Reçu d’une opération',
    description:
      'Référence, montant, solde avant et après, objectif, compte, client, quincaillerie, auteur et date.',
  })
  @ApiParam({ name: 'operationId', description: 'Identifiant de l’opération' })
  @ApiOkResponse({ description: 'Reçu', type: OperationReceipt })
  @ApiBadRequestResponse({
    description:
      'Identifiant de quincaillerie, de compte ou d’opération invalide',
    type: ErrorResponse,
  })
  receipt(
    @CurrentStore() store: CurrentStoreContext,
    @Param('accountId', AccountIdPipe) accountId: string,
    @Param('operationId', OperationIdPipe) operationId: string,
  ): Promise<OperationReceipt> {
    return this.ledger.receipt(store.storeId, accountId, operationId);
  }
}
