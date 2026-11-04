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
import { ErrorResponse } from '../common/errors/error-response.js';
import { ApiPaginatedResponse, type Paginated } from '../common/pagination.js';
import type { AuthenticatedUser } from '../mobile-auth/authenticated-user.js';
import { CurrentUser } from '../mobile-auth/decorators/current-user.decorator.js';
import { MobileRoute } from '../mobile-auth/decorators/mobile-route.decorator.js';
import { ScanQrCodeDto } from '../qr-codes/dto/qr-code.dto.js';
import type { CurrentStoreContext } from '../store-access/current-store.js';
import { CurrentStore } from '../store-access/decorators/current-store.decorator.js';
import { StoreRoles } from '../store-access/decorators/store-roles.decorator.js';
import { invalidAccountId } from './accounts.errors.js';
import { AccountsService } from './accounts.service.js';
import { AccountDetail } from './dto/account-detail.js';
import {
  AccountSummary,
  ListAccountsQueryDto,
} from './dto/list-accounts.dto.js';
import { OpenAccountDto } from './dto/open-account.dto.js';

const AccountIdPipe = new ParseUUIDPipe({ exceptionFactory: invalidAccountId });

@ApiTags('Mobile - Comptes clients')
@ApiBearerAuth()
@ApiParam({ name: 'storeId', description: 'Identifiant de la quincaillerie' })
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
    'Quincaillerie introuvable : vous n’en êtes pas membre actif, ou compte introuvable dans cette quincaillerie',
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
@Controller('stores/:storeId/accounts')
export class AccountsController {
  constructor(private readonly accounts: AccountsService) {}

  /**
   * @description Open a customer's savings account at the counter (creates the customer if the phone is new)
   * @route POST /api/v1/stores/:storeId/accounts
   * @access Store seller or manager (mobile session)
   * @param storeId the store
   * @body OpenAccountDto (customer { phone, firstName, lastName }, beneficiary? { name, phone? }, termsAccepted: true)
   * @returns 201 AccountDetail; 409 STORE_NOT_VERIFIED, ACCOUNT_EXISTS or OWN_ACCOUNT
   */
  @Post()
  @ApiOperation({
    summary: 'Ouvrir un compte client',
    description:
      'Le client est trouvé par son numéro ; s’il n’a pas encore de compte utilisateur, il est créé avec ces nom et prénom (sans PIN : il active l’application par code SMS). Un utilisateur existant garde ses nom et prénom, renvoyés dans la réponse. Le compte reçoit un numéro (C-000123), la devise du pays, un solde de 0 et son objectif « Non affecté ». Un seul compte par client et par quincaillerie ; un membre de l’équipe ne peut pas ouvrir de compte à son propre nom. Seulement pour une quincaillerie vérifiée.',
  })
  @ApiCreatedResponse({ description: 'Compte ouvert', type: AccountDetail })
  @ApiBadRequestResponse({
    description:
      'Identifiant de quincaillerie invalide ; données invalides, conditions non acceptées, ou numéro d’un autre pays que la quincaillerie (`details`)',
    type: ErrorResponse,
  })
  @ApiConflictResponse({
    description:
      'Quincaillerie non vérifiée (`STORE_NOT_VERIFIED`) ; le client a déjà un compte ici (`ACCOUNT_EXISTS`) ; compte à votre propre nom (`OWN_ACCOUNT`)',
    type: ErrorResponse,
  })
  open(
    @CurrentStore() store: CurrentStoreContext,
    @CurrentUser() actor: AuthenticatedUser,
    @Body() body: OpenAccountDto,
  ): Promise<AccountDetail> {
    return this.accounts.open(store, actor, body);
  }

  /**
   * @description Search the store's customer accounts, newest first
   * @route GET /api/v1/stores/:storeId/accounts
   * @access Store seller or manager (mobile session)
   * @param storeId the store
   * @query ListAccountsQueryDto (page, pageSize, q?)
   * @returns 200 Paginated<AccountSummary>
   */
  @Get()
  @ApiOperation({
    summary: 'Rechercher les comptes clients',
    description:
      'Comptes de cette quincaillerie seulement, du plus récent au plus ancien. `q` cherche dans le numéro de compte (C-000123), le téléphone du client (76 44 55 66 ou +223 76 44 55 66) et ses nom et prénom.',
  })
  @ApiPaginatedResponse(AccountSummary, 'Page de comptes')
  @ApiBadRequestResponse({
    description:
      'Identifiant de quincaillerie invalide ; recherche ou pagination invalide (`details`)',
    type: ErrorResponse,
  })
  list(
    @CurrentStore() store: CurrentStoreContext,
    @Query() query: ListAccountsQueryDto,
    @CurrentUser() viewer: AuthenticatedUser,
  ): Promise<Paginated<AccountSummary>> {
    return this.accounts.list(store.storeId, query, viewer.userId);
  }

  /**
   * @description Reach a customer's account in this store by scanning their QR code
   * @route POST /api/v1/stores/:storeId/accounts/scan
   * @access Store seller or manager (mobile session)
   * @param storeId the store
   * @body ScanQrCodeDto (code)
   * @returns 200 AccountDetail; 404 Compte introuvable (unknown code, or no account in this store)
   */
  @Post('scan')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Scanner le QR code d’un client',
    description:
      'Retrouve le compte du client dans cette quincaillerie à partir du code de son QR code. Un code inconnu ou remplacé et une personne sans compte ici répondent le même 404 « Compte introuvable ».',
  })
  @ApiOkResponse({ description: 'Compte du client', type: AccountDetail })
  @ApiBadRequestResponse({
    description:
      'Identifiant de quincaillerie invalide ; code QR invalide (`details`)',
    type: ErrorResponse,
  })
  scan(
    @CurrentStore() store: CurrentStoreContext,
    @Body() body: ScanQrCodeDto,
    @CurrentUser() viewer: AuthenticatedUser,
  ): Promise<AccountDetail> {
    return this.accounts.scan(store.storeId, body.code, viewer.userId);
  }

  /**
   * @description Read one customer account of the store, with its goals
   * @route GET /api/v1/stores/:storeId/accounts/:accountId
   * @access Store seller or manager (mobile session)
   * @param storeId the store
   * @param accountId the account
   * @returns 200 AccountDetail; 404 account not in this store
   */
  @Get(':accountId')
  @ApiOperation({
    summary: 'Détail d’un compte client',
    description:
      'Titulaire, bénéficiaire, solde, objectifs. Un compte d’une autre quincaillerie répond 404.',
  })
  @ApiParam({ name: 'accountId', description: 'Identifiant du compte' })
  @ApiOkResponse({ description: 'Compte', type: AccountDetail })
  @ApiBadRequestResponse({
    description: 'Identifiant de quincaillerie ou de compte invalide',
    type: ErrorResponse,
  })
  detail(
    @CurrentStore() store: CurrentStoreContext,
    @Param('accountId', AccountIdPipe) accountId: string,
    @CurrentUser() viewer: AuthenticatedUser,
  ): Promise<AccountDetail> {
    return this.accounts.detail(store.storeId, accountId, viewer.userId);
  }
}
