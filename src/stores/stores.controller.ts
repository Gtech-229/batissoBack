import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { RequirePermission } from '../admin-auth/decorators/require-permission.decorator.js';
import {
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiCookieAuth,
  ApiCreatedResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import type { AuthenticatedAdmin } from '../admin-auth/authenticated-admin.js';
import { CurrentAdmin } from '../admin-auth/decorators/current-admin.decorator.js';
import { ErrorResponse } from '../common/errors/error-response.js';
import { ApiPaginatedResponse, type Paginated } from '../common/pagination.js';
import { ListStoresQueryDto, StoreSummary } from './dto/list-stores.dto.js';
import { RegisterStoreDto } from './dto/register-store.dto.js';
import { StatusReasonDto } from './dto/status-reason.dto.js';
import { StoreDetail } from './dto/store-detail.js';
import {
  UpdateStoreDto,
  UpdateStoreSettingsDto,
} from './dto/update-store.dto.js';
import { invalidStoreId } from './stores.errors.js';
import { StoresService } from './stores.service.js';

// French error for a malformed id instead of Nest's "Validation failed (uuid is expected)".
const StoreIdPipe = new ParseUUIDPipe({ exceptionFactory: invalidStoreId });

@ApiTags('Administration - Quincailleries')
@ApiCookieAuth()
@ApiUnauthorizedResponse({ description: 'Non connecté', type: ErrorResponse })
@Controller('admin/stores')
export class StoresController {
  constructor(private readonly stores: StoresService) {}

  /**
   * @description Register a store (PENDING) with its money settings and first manager
   * @route POST /api/v1/admin/stores
   * @access Admin
   * @body RegisterStoreDto (countryCode, name, address, city, phone, tradeRegister, settings, manager)
   * @returns 201 StoreDetail; 404 unknown country; 409 COUNTRY_INACTIVE
   */
  @Post()
  @RequirePermission('stores.manage')
  @ApiOperation({
    summary: 'Inscrire une quincaillerie',
    description:
      'Crée la quincaillerie (statut PENDING), ses paramètres et son premier gérant en une seule opération. Si le numéro du gérant existe déjà, la personne existante devient gérante (ses nom et prénom ne changent pas). Les montants sont des chaînes en plus petite unité de la devise du pays.',
  })
  @ApiCreatedResponse({
    description: 'Quincaillerie inscrite',
    type: StoreDetail,
  })
  @ApiBadRequestResponse({
    description:
      'Données invalides : format, téléphone d’un autre pays, dépôt minimum supérieur au solde maximal',
    type: ErrorResponse,
  })
  @ApiNotFoundResponse({ description: 'Pays introuvable', type: ErrorResponse })
  @ApiConflictResponse({
    description: 'Le pays n’est pas actif (`COUNTRY_INACTIVE`)',
    type: ErrorResponse,
  })
  register(
    @Body() body: RegisterStoreDto,
    @CurrentAdmin() current: AuthenticatedAdmin,
  ): Promise<StoreDetail> {
    return this.stores.register(body, current.adminId);
  }

  /**
   * @description Paginated store list, newest first, with optional filters
   * @route GET /api/v1/admin/stores
   * @access Admin
   * @query page, pageSize, status?, countryCode?, q? (name or city)
   * @returns 200 { items: StoreSummary[], total, page, pageSize }
   */
  @Get()
  @RequirePermission('stores.read')
  @ApiOperation({
    summary: 'Lister les quincailleries',
    description:
      'Liste paginée, de la plus récente à la plus ancienne. Les filtres se combinent ; `q` cherche dans le nom et la ville sans tenir compte des majuscules.',
  })
  @ApiPaginatedResponse(StoreSummary, 'Page de quincailleries')
  @ApiBadRequestResponse({
    description: 'Paramètres de recherche invalides',
    type: ErrorResponse,
  })
  list(@Query() query: ListStoresQueryDto): Promise<Paginated<StoreSummary>> {
    return this.stores.list(query);
  }

  /**
   * @description Correct a store's information (partial)
   * @route PATCH /api/v1/admin/stores/:id
   * @access Admin
   * @param id (UUID) store id
   * @body UpdateStoreDto (name?, address?, city?, phone?, tradeRegister?)
   * @returns 200 StoreDetail; 409 STORE_CLOSED
   */
  @Patch(':id')
  @RequirePermission('stores.manage')
  @ApiOperation({
    summary: 'Modifier les informations d’une quincaillerie',
    description:
      'Mise à jour partielle. Le téléphone doit être un numéro du pays de la quincaillerie. Une quincaillerie fermée ne peut plus être modifiée.',
  })
  @ApiParam({ name: 'id', description: 'Identifiant de la quincaillerie' })
  @ApiOkResponse({ description: 'Quincaillerie modifiée', type: StoreDetail })
  @ApiBadRequestResponse({
    description: 'Données invalides',
    type: ErrorResponse,
  })
  @ApiNotFoundResponse({
    description: 'Quincaillerie introuvable',
    type: ErrorResponse,
  })
  @ApiConflictResponse({
    description: 'Quincaillerie fermée (`STORE_CLOSED`)',
    type: ErrorResponse,
  })
  update(
    @Param('id', StoreIdPipe) id: string,
    @Body() body: UpdateStoreDto,
  ): Promise<StoreDetail> {
    return this.stores.update(id, body);
  }

  /**
   * @description Change a store's settings (partial): amounts, terms, delivery delay
   * @route PATCH /api/v1/admin/stores/:id/settings
   * @access Admin
   * @param id (UUID) store id
   * @body UpdateStoreSettingsDto (maxBalance?, validationThreshold?, minDeposit?, terms?, deliveryDelayDays?)
   * @returns 200 StoreDetail; 400 if minDeposit would exceed maxBalance; 409 STORE_CLOSED
   */
  @Patch(':id/settings')
  @RequirePermission('store-settings.manage')
  @ApiOperation({
    summary: 'Modifier les paramètres d’une quincaillerie',
    description:
      'Mise à jour partielle des montants (chaînes en plus petite unité de la devise) et des conditions générales (`null` les efface), et du délai de livraison (`deliveryDelayDays`, 1 à 365 jours : au-delà, un client peut demander l’annulation d’un bon payé non livré). Le dépôt minimum ne peut pas dépasser le solde maximal, en tenant compte des valeurs actuelles.',
  })
  @ApiParam({ name: 'id', description: 'Identifiant de la quincaillerie' })
  @ApiOkResponse({ description: 'Paramètres modifiés', type: StoreDetail })
  @ApiBadRequestResponse({
    description: 'Données invalides',
    type: ErrorResponse,
  })
  @ApiNotFoundResponse({
    description: 'Quincaillerie introuvable',
    type: ErrorResponse,
  })
  @ApiConflictResponse({
    description: 'Quincaillerie fermée (`STORE_CLOSED`)',
    type: ErrorResponse,
  })
  updateSettings(
    @Param('id', StoreIdPipe) id: string,
    @Body() body: UpdateStoreSettingsDto,
    @CurrentAdmin() current: AuthenticatedAdmin,
  ): Promise<StoreDetail> {
    return this.stores.updateSettings(id, body, current.adminId);
  }

  /**
   * @description Verify a pending store after checking its papers
   * @route PATCH /api/v1/admin/stores/:id/verify
   * @access Admin
   * @param id (UUID) store id
   * @returns 200 StoreDetail (VERIFIED, verifiedAt set); 409 INVALID_STATUS_TRANSITION or STORE_DOCUMENTS_MISSING
   */
  @Patch(':id/verify')
  @RequirePermission('stores.manage')
  @ApiOperation({
    summary: 'Vérifier une quincaillerie',
    description:
      'PENDING -> VERIFIED, après contrôle du registre du commerce et de l’identité du gérant. Une quincaillerie inscrite depuis l’application exige ses deux documents (pièce d’identité du gérant et registre du commerce).',
  })
  @ApiParam({ name: 'id', description: 'Identifiant de la quincaillerie' })
  @ApiOkResponse({ description: 'Quincaillerie vérifiée', type: StoreDetail })
  @ApiNotFoundResponse({
    description: 'Quincaillerie introuvable',
    type: ErrorResponse,
  })
  @ApiConflictResponse({
    description:
      'Statut actuel incompatible (`INVALID_STATUS_TRANSITION`) ; quincaillerie inscrite depuis l’application sans ses deux documents (`STORE_DOCUMENTS_MISSING`)',
    type: ErrorResponse,
  })
  verify(
    @Param('id', StoreIdPipe) id: string,
    @CurrentAdmin() current: AuthenticatedAdmin,
  ): Promise<StoreDetail> {
    return this.stores.changeStatus(id, 'verify', current.adminId);
  }

  /**
   * @description Suspend a verified store (no new deposits; purchases still served)
   * @route PATCH /api/v1/admin/stores/:id/suspend
   * @access Admin
   * @param id (UUID) store id
   * @body StatusReasonDto (reason)
   * @returns 200 StoreDetail (SUSPENDED); 409 INVALID_STATUS_TRANSITION
   */
  @Patch(':id/suspend')
  @RequirePermission('stores.manage')
  @ApiOperation({
    summary: 'Suspendre une quincaillerie',
    description:
      'VERIFIED -> SUSPENDED, avec un motif. Une quincaillerie suspendue ne prend plus de dépôts mais continue de servir les achats de ses clients.',
  })
  @ApiParam({ name: 'id', description: 'Identifiant de la quincaillerie' })
  @ApiOkResponse({ description: 'Quincaillerie suspendue', type: StoreDetail })
  @ApiBadRequestResponse({
    description: 'Motif manquant ou invalide',
    type: ErrorResponse,
  })
  @ApiNotFoundResponse({
    description: 'Quincaillerie introuvable',
    type: ErrorResponse,
  })
  @ApiConflictResponse({
    description: 'Statut actuel incompatible (`INVALID_STATUS_TRANSITION`)',
    type: ErrorResponse,
  })
  suspend(
    @Param('id', StoreIdPipe) id: string,
    @Body() body: StatusReasonDto,
    @CurrentAdmin() current: AuthenticatedAdmin,
  ): Promise<StoreDetail> {
    return this.stores.changeStatus(
      id,
      'suspend',
      current.adminId,
      body.reason,
    );
  }

  /**
   * @description Lift a suspension
   * @route PATCH /api/v1/admin/stores/:id/reactivate
   * @access Admin
   * @param id (UUID) store id
   * @returns 200 StoreDetail (VERIFIED, reason cleared); 409 INVALID_STATUS_TRANSITION
   */
  @Patch(':id/reactivate')
  @RequirePermission('stores.manage')
  @ApiOperation({
    summary: 'Réactiver une quincaillerie',
    description: 'SUSPENDED -> VERIFIED. Le motif de suspension est effacé.',
  })
  @ApiParam({ name: 'id', description: 'Identifiant de la quincaillerie' })
  @ApiOkResponse({ description: 'Quincaillerie réactivée', type: StoreDetail })
  @ApiNotFoundResponse({
    description: 'Quincaillerie introuvable',
    type: ErrorResponse,
  })
  @ApiConflictResponse({
    description: 'Statut actuel incompatible (`INVALID_STATUS_TRANSITION`)',
    type: ErrorResponse,
  })
  reactivate(
    @Param('id', StoreIdPipe) id: string,
    @CurrentAdmin() current: AuthenticatedAdmin,
  ): Promise<StoreDetail> {
    return this.stores.changeStatus(id, 'reactivate', current.adminId);
  }

  /**
   * @description Close a store for good (final; history is kept)
   * @route PATCH /api/v1/admin/stores/:id/close
   * @access Admin
   * @param id (UUID) store id
   * @body StatusReasonDto (reason)
   * @returns 200 StoreDetail (CLOSED); 409 INVALID_STATUS_TRANSITION if already closed
   */
  @Patch(':id/close')
  @RequirePermission('stores.manage')
  @ApiOperation({
    summary: 'Fermer une quincaillerie',
    description:
      'PENDING, VERIFIED ou SUSPENDED -> CLOSED, avec un motif. Définitif : une quincaillerie fermée ne peut plus être modifiée ni rouverte ; son historique est conservé.',
  })
  @ApiParam({ name: 'id', description: 'Identifiant de la quincaillerie' })
  @ApiOkResponse({ description: 'Quincaillerie fermée', type: StoreDetail })
  @ApiBadRequestResponse({
    description: 'Motif manquant ou invalide',
    type: ErrorResponse,
  })
  @ApiNotFoundResponse({
    description: 'Quincaillerie introuvable',
    type: ErrorResponse,
  })
  @ApiConflictResponse({
    description: 'Déjà fermée (`INVALID_STATUS_TRANSITION`)',
    type: ErrorResponse,
  })
  close(
    @Param('id', StoreIdPipe) id: string,
    @Body() body: StatusReasonDto,
    @CurrentAdmin() current: AuthenticatedAdmin,
  ): Promise<StoreDetail> {
    return this.stores.changeStatus(id, 'close', current.adminId, body.reason);
  }

  /**
   * @description Store details: country, settings (amounts as strings), managers
   * @route GET /api/v1/admin/stores/:id
   * @access Admin
   * @param id (UUID) store id
   * @returns 200 StoreDetail; 404 if unknown
   */
  @Get(':id')
  @RequirePermission('stores.read')
  @ApiOperation({ summary: 'Détail d’une quincaillerie' })
  @ApiParam({ name: 'id', description: 'Identifiant de la quincaillerie' })
  @ApiOkResponse({ description: 'Quincaillerie', type: StoreDetail })
  @ApiBadRequestResponse({
    description: 'Identifiant invalide',
    type: ErrorResponse,
  })
  @ApiNotFoundResponse({
    description: 'Quincaillerie introuvable',
    type: ErrorResponse,
  })
  findOne(@Param('id', StoreIdPipe) id: string): Promise<StoreDetail> {
    return this.stores.findOne(id);
  }
}
