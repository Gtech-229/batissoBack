import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  StreamableFile,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { RequirePermission } from '../admin-auth/decorators/require-permission.decorator.js';
import {
  ApiBadRequestResponse,
  ApiBody,
  ApiConflictResponse,
  ApiConsumes,
  ApiCookieAuth,
  ApiCreatedResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiForbiddenResponse,
  ApiOperation,
  ApiParam,
  ApiProduces,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import type { AuthenticatedAdmin } from '../admin-auth/authenticated-admin.js';
import { CurrentAdmin } from '../admin-auth/decorators/current-admin.decorator.js';
import { ErrorResponse } from '../common/errors/error-response.js';
import { ApiPaginatedResponse, type Paginated } from '../common/pagination.js';
import {
  BulkStatusReasonDto,
  BulkStatusResult,
  BulkStoreIdsDto,
} from './dto/bulk-status.dto.js';
import { ListStoresQueryDto, StoreSummary } from './dto/list-stores.dto.js';
import { RegisterStoreDto } from './dto/register-store.dto.js';
import {
  ImportTemplateQueryDto,
  StoreImportFileBody,
  StoreImportQueryDto,
  StoreImportResult,
} from './dto/store-import.dto.js';
import { StoreImportService } from './import/store-import.service.js';
import { buildImportTemplate } from './import/store-import-template.js';
import { StoreImportUploadInterceptor } from './import/store-import-upload.interceptor.js';
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
  constructor(
    private readonly stores: StoresService,
    private readonly storeImport: StoreImportService,
  ) {}

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
   * @description Download the empty store import template (header row only)
   * @route GET /api/v1/admin/stores/import/template
   * @access Admin (stores.manage)
   * @query ImportTemplateQueryDto (format: csv | xlsx)
   * @returns 200 the template file (attachment); 400 bad format
   */
  @Get('import/template')
  @RequirePermission('stores.manage')
  @Header('Cache-Control', 'no-store')
  @Header('X-Content-Type-Options', 'nosniff')
  @ApiOperation({
    summary: 'Modèle d’import des quincailleries',
    description:
      'Fichier vide (ligne d’en-tête seule), une colonne par champ de l’inscription : countryCode, name, address, city, phone, tradeRegister, settings.maxBalance, settings.validationThreshold, settings.minDeposit, settings.terms (facultatif), settings.deliveryDelayDays (facultatif), manager.firstName, manager.lastName, manager.phone. Le CSV est en UTF-8 avec séparateur point-virgule.',
  })
  @ApiProduces(
    'text/csv',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  )
  @ApiOkResponse({
    description: 'Le modèle, en pièce jointe',
    schema: { type: 'string', format: 'binary' },
  })
  @ApiBadRequestResponse({
    description: 'Format autre que csv ou xlsx',
    type: ErrorResponse,
  })
  @ApiForbiddenResponse({
    description: 'Permission stores.manage requise',
    type: ErrorResponse,
  })
  async importTemplate(
    @Query() query: ImportTemplateQueryDto,
  ): Promise<StreamableFile> {
    const template = await buildImportTemplate(query.format);
    return new StreamableFile(template.content, {
      type: template.contentType,
      disposition: `attachment; filename="${template.fileName}"`,
    });
  }

  /**
   * @description Import stores from a CSV or XLSX file: dry run, or create each valid row
   * @route POST /api/v1/admin/stores/import
   * @access Admin (stores.manage)
   * @query StoreImportQueryDto (dryRun: true | false)
   * @body multipart file (.csv or .xlsx, 2 MB, 500 rows)
   * @returns 200 StoreImportResult (per-row status and errors); 400 file refused
   */
  @Post('import')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('stores.manage')
  @UseInterceptors(StoreImportUploadInterceptor)
  @ApiOperation({
    summary: 'Importer des quincailleries (CSV ou XLSX)',
    description:
      'Chaque ligne est vérifiée exactement comme une inscription (POST /admin/stores) : mêmes règles, pays actif, numéros du pays, dépôt minimum. Une ligne dont le registre du commerce existe déjà pour ce pays, plus haut dans le fichier ou chez une quincaillerie inscrite, est refusée. dryRun=true ne crée rien ; dryRun=false crée chaque ligne valide indépendamment (statut PENDING) : une ligne refusée n’annule pas les autres. Colonnes : celles du modèle (GET /admin/stores/import/template).',
  })
  @ApiConsumes('multipart/form-data')
  @ApiBody({ type: StoreImportFileBody })
  @ApiOkResponse({
    description: 'Résultat ligne par ligne',
    type: StoreImportResult,
  })
  @ApiBadRequestResponse({
    description:
      'Fichier refusé en entier (rien n’est vérifié ni créé) : IMPORT_FILE_INVALID (absent, autre que .csv/.xlsx, plus de 2 Mo, illisible, CSV pas en UTF-8), IMPORT_EMPTY, IMPORT_TOO_MANY_ROWS (plus de 500 lignes), IMPORT_UNKNOWN_COLUMN, IMPORT_MISSING_COLUMN, IMPORT_DUPLICATE_COLUMN ; ou dryRun absent ou autre que true/false',
    type: ErrorResponse,
  })
  @ApiForbiddenResponse({
    description: 'Permission stores.manage requise',
    type: ErrorResponse,
  })
  importStores(
    @Query() query: StoreImportQueryDto,
    @UploadedFile() file: Express.Multer.File | undefined,
    @CurrentAdmin() current: AuthenticatedAdmin,
  ): Promise<StoreImportResult> {
    return this.storeImport.import(file, query.dryRun, current.adminId);
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
   * @description Verify several stores at once, each with the single action's rules and its own result
   * @route POST /api/v1/admin/stores/bulk/verify
   * @access Admin (stores.manage)
   * @body BulkStoreIdsDto (ids)
   * @returns 200 BulkStatusResult (one result per store); 400 invalid body
   */
  @Post('bulk/verify')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('stores.manage')
  @ApiOperation({
    summary: 'Vérifier plusieurs quincailleries',
    description:
      'PENDING -> VERIFIED pour chaque quincaillerie. Une quincaillerie inscrite depuis l’application exige ses deux documents (STORE_DOCUMENTS_MISSING sinon) : documentsComplete dans la liste le dit à l’avance. Chaque quincaillerie est traitée seule, dans l’ordre, avec exactement les règles de l’action unitaire ; un refus n’empêche pas les autres. Chaque résultat donne ok, ou le code et le message que l’action unitaire aurait renvoyés (dont NOT_FOUND pour un identifiant inconnu). 1 à 100 identifiants, doublons ignorés.',
  })
  @ApiOkResponse({
    description: 'Un résultat par quincaillerie',
    type: BulkStatusResult,
  })
  @ApiBadRequestResponse({
    description:
      'Liste vide, plus de 100 identifiants, identifiant qui n’est pas un UUID : rien n’est modifié',
    type: ErrorResponse,
  })
  @ApiForbiddenResponse({
    description: 'Permission stores.manage requise',
    type: ErrorResponse,
  })
  verifyMany(
    @Body() body: BulkStoreIdsDto,
    @CurrentAdmin() current: AuthenticatedAdmin,
  ): Promise<BulkStatusResult> {
    return this.stores.changeStatusMany(body.ids, 'verify', current.adminId);
  }

  /**
   * @description Suspend several stores at once, each with the single action's rules and its own result
   * @route POST /api/v1/admin/stores/bulk/suspend
   * @access Admin (stores.manage)
   * @body BulkStatusReasonDto (ids, reason)
   * @returns 200 BulkStatusResult (one result per store); 400 invalid body
   */
  @Post('bulk/suspend')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('stores.manage')
  @ApiOperation({
    summary: 'Suspendre plusieurs quincailleries',
    description:
      'VERIFIED -> SUSPENDED pour chaque quincaillerie, avec le même motif (plus de nouveaux dépôts, les achats restent servis). Chaque quincaillerie est traitée seule, dans l’ordre, avec exactement les règles de l’action unitaire ; un refus n’empêche pas les autres. Chaque résultat donne ok, ou le code et le message que l’action unitaire aurait renvoyés (dont NOT_FOUND pour un identifiant inconnu). 1 à 100 identifiants, doublons ignorés.',
  })
  @ApiOkResponse({
    description: 'Un résultat par quincaillerie',
    type: BulkStatusResult,
  })
  @ApiBadRequestResponse({
    description:
      'Liste vide, plus de 100 identifiants, identifiant qui n’est pas un UUID, motif absent ou hors 3 à 500 caractères : rien n’est modifié',
    type: ErrorResponse,
  })
  @ApiForbiddenResponse({
    description: 'Permission stores.manage requise',
    type: ErrorResponse,
  })
  suspendMany(
    @Body() body: BulkStatusReasonDto,
    @CurrentAdmin() current: AuthenticatedAdmin,
  ): Promise<BulkStatusResult> {
    return this.stores.changeStatusMany(
      body.ids,
      'suspend',
      current.adminId,
      body.reason,
    );
  }

  /**
   * @description Reactivate several stores at once, each with the single action's rules and its own result
   * @route POST /api/v1/admin/stores/bulk/reactivate
   * @access Admin (stores.manage)
   * @body BulkStoreIdsDto (ids)
   * @returns 200 BulkStatusResult (one result per store); 400 invalid body
   */
  @Post('bulk/reactivate')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('stores.manage')
  @ApiOperation({
    summary: 'Réactiver plusieurs quincailleries',
    description:
      'SUSPENDED -> VERIFIED pour chaque quincaillerie ; le motif de suspension est effacé. Chaque quincaillerie est traitée seule, dans l’ordre, avec exactement les règles de l’action unitaire ; un refus n’empêche pas les autres. Chaque résultat donne ok, ou le code et le message que l’action unitaire aurait renvoyés (dont NOT_FOUND pour un identifiant inconnu). 1 à 100 identifiants, doublons ignorés.',
  })
  @ApiOkResponse({
    description: 'Un résultat par quincaillerie',
    type: BulkStatusResult,
  })
  @ApiBadRequestResponse({
    description:
      'Liste vide, plus de 100 identifiants, identifiant qui n’est pas un UUID : rien n’est modifié',
    type: ErrorResponse,
  })
  @ApiForbiddenResponse({
    description: 'Permission stores.manage requise',
    type: ErrorResponse,
  })
  reactivateMany(
    @Body() body: BulkStoreIdsDto,
    @CurrentAdmin() current: AuthenticatedAdmin,
  ): Promise<BulkStatusResult> {
    return this.stores.changeStatusMany(
      body.ids,
      'reactivate',
      current.adminId,
    );
  }

  /**
   * @description Close several stores at once, each with the single action's rules and its own result
   * @route POST /api/v1/admin/stores/bulk/close
   * @access Admin (stores.manage)
   * @body BulkStatusReasonDto (ids, reason)
   * @returns 200 BulkStatusResult (one result per store); 400 invalid body
   */
  @Post('bulk/close')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('stores.manage')
  @ApiOperation({
    summary: 'Fermer plusieurs quincailleries',
    description:
      'Fermeture définitive de chaque quincaillerie, avec le même motif (depuis PENDING, VERIFIED ou SUSPENDED). Chaque quincaillerie est traitée seule, dans l’ordre, avec exactement les règles de l’action unitaire ; un refus n’empêche pas les autres. Chaque résultat donne ok, ou le code et le message que l’action unitaire aurait renvoyés (dont NOT_FOUND pour un identifiant inconnu). 1 à 100 identifiants, doublons ignorés.',
  })
  @ApiOkResponse({
    description: 'Un résultat par quincaillerie',
    type: BulkStatusResult,
  })
  @ApiBadRequestResponse({
    description:
      'Liste vide, plus de 100 identifiants, identifiant qui n’est pas un UUID, motif absent ou hors 3 à 500 caractères : rien n’est modifié',
    type: ErrorResponse,
  })
  @ApiForbiddenResponse({
    description: 'Permission stores.manage requise',
    type: ErrorResponse,
  })
  closeMany(
    @Body() body: BulkStatusReasonDto,
    @CurrentAdmin() current: AuthenticatedAdmin,
  ): Promise<BulkStatusResult> {
    return this.stores.changeStatusMany(
      body.ids,
      'close',
      current.adminId,
      body.reason,
    );
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
