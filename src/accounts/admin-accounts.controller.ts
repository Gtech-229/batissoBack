import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Query,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiCookieAuth,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import type { AuthenticatedAdmin } from '../admin-auth/authenticated-admin.js';
import { CurrentAdmin } from '../admin-auth/decorators/current-admin.decorator.js';
import { RequirePermission } from '../admin-auth/decorators/require-permission.decorator.js';
import { ErrorResponse } from '../common/errors/error-response.js';
import { ApiPaginatedResponse, type Paginated } from '../common/pagination.js';
import { StatusReasonDto } from '../stores/dto/status-reason.dto.js';
import { invalidAccountId } from './accounts.errors.js';
import { AdminAccountsService } from './admin-accounts.service.js';
import {
  AdminAccountsQueryDto,
  AdminAccountSummary,
} from './dto/admin-account.dto.js';

const AccountIdPipe = new ParseUUIDPipe({ exceptionFactory: invalidAccountId });

@ApiTags('Administration - Comptes clients')
@ApiCookieAuth()
@ApiUnauthorizedResponse({ description: 'Non connecté', type: ErrorResponse })
@ApiForbiddenResponse({
  description: 'Permission manquante',
  type: ErrorResponse,
})
@Controller('admin/accounts')
export class AdminAccountsController {
  constructor(private readonly accounts: AdminAccountsService) {}

  /**
   * @description Search customers' accounts across stores, newest first
   * @route GET /api/v1/admin/accounts
   * @access Admin with accounts.read
   * @query q, storeId, status, page, pageSize
   * @returns Paginated AdminAccountSummary (never a balance)
   */
  @Get()
  @RequirePermission('accounts.read')
  @ApiOperation({
    summary: 'Rechercher les comptes clients',
    description:
      'Tous les comptes, du plus récent au plus ancien, filtrables par quincaillerie et par état. La recherche porte sur le numéro, les nom et prénom du client ou les chiffres de son téléphone. Aucun solde ni aucune opération : un administrateur ne voit pas l’argent des clients.',
  })
  @ApiPaginatedResponse(AdminAccountSummary, 'Page de comptes')
  @ApiBadRequestResponse({
    description: 'Filtre invalide (`details`)',
    type: ErrorResponse,
  })
  list(
    @Query() query: AdminAccountsQueryDto,
  ): Promise<Paginated<AdminAccountSummary>> {
    return this.accounts.list(query);
  }

  /**
   * @description Suspend an account: no deposits or goal moves; purchases still served
   * @route PATCH /api/v1/admin/accounts/:id/suspend
   * @access Admin with accounts.manage
   * @param id (UUID) account id
   * @body StatusReasonDto (reason)
   * @returns AdminAccountSummary (SUSPENDED); 404; 409 INVALID_STATUS_TRANSITION, STORE_CLOSED
   */
  @Patch(':id/suspend')
  @RequirePermission('accounts.manage')
  @ApiOperation({
    summary: 'Suspendre un compte',
    description:
      'ACTIVE -> SUSPENDED, avec un motif, visible du personnel de la quincaillerie mais jamais du client. Un compte suspendu ne prend plus de dépôts ni de mouvements entre objectifs ; ses achats restent possibles. Les autres comptes du client ne changent pas.',
  })
  @ApiParam({ name: 'id', description: 'Identifiant du compte' })
  @ApiOkResponse({ description: 'Compte suspendu', type: AdminAccountSummary })
  @ApiBadRequestResponse({
    description: 'Identifiant ou motif invalide (`details`)',
    type: ErrorResponse,
  })
  @ApiNotFoundResponse({
    description: 'Compte introuvable',
    type: ErrorResponse,
  })
  @ApiConflictResponse({
    description:
      'Compte déjà suspendu (`INVALID_STATUS_TRANSITION`) ou quincaillerie fermée (`STORE_CLOSED`)',
    type: ErrorResponse,
  })
  suspend(
    @Param('id', AccountIdPipe) id: string,
    @Body() body: StatusReasonDto,
    @CurrentAdmin() admin: AuthenticatedAdmin,
  ): Promise<AdminAccountSummary> {
    return this.accounts.suspend(id, body.reason, admin.adminId);
  }

  /**
   * @description Reactivate a suspended account; the reason is cleared
   * @route PATCH /api/v1/admin/accounts/:id/reactivate
   * @access Admin with accounts.manage
   * @param id (UUID) account id
   * @returns AdminAccountSummary (ACTIVE); 404; 409 INVALID_STATUS_TRANSITION, STORE_CLOSED
   */
  @Patch(':id/reactivate')
  @RequirePermission('accounts.manage')
  @ApiOperation({
    summary: 'Réactiver un compte',
    description:
      'SUSPENDED -> ACTIVE : les dépôts et les mouvements entre objectifs reprennent. Le motif de suspension est effacé.',
  })
  @ApiParam({ name: 'id', description: 'Identifiant du compte' })
  @ApiOkResponse({ description: 'Compte réactivé', type: AdminAccountSummary })
  @ApiBadRequestResponse({
    description: 'Identifiant invalide',
    type: ErrorResponse,
  })
  @ApiNotFoundResponse({
    description: 'Compte introuvable',
    type: ErrorResponse,
  })
  @ApiConflictResponse({
    description:
      'Compte non suspendu (`INVALID_STATUS_TRANSITION`) ou quincaillerie fermée (`STORE_CLOSED`)',
    type: ErrorResponse,
  })
  reactivate(
    @Param('id', AccountIdPipe) id: string,
    @CurrentAdmin() admin: AuthenticatedAdmin,
  ): Promise<AdminAccountSummary> {
    return this.accounts.reactivate(id, admin.adminId);
  }
}
