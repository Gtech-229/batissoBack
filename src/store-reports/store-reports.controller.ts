import {
  applyDecorators,
  Controller,
  Get,
  Header,
  Query,
  StreamableFile,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiConflictResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiProduces,
  ApiParam,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { ErrorResponse } from '../common/errors/error-response.js';
import type { AuthenticatedUser } from '../mobile-auth/authenticated-user.js';
import { CurrentUser } from '../mobile-auth/decorators/current-user.decorator.js';
import { MobileRoute } from '../mobile-auth/decorators/mobile-route.decorator.js';
import type { CurrentStoreContext } from '../store-access/current-store.js';
import { CurrentStore } from '../store-access/decorators/current-store.decorator.js';
import { StoreRoles } from '../store-access/decorators/store-roles.decorator.js';
import {
  ExportCustomersDto,
  ExportPeriodDto,
} from './dto/report-export.dto.js';
import { ReportPeriodDto } from './dto/report-period.dto.js';
import {
  CustomersQueryDto,
  CustomersReport,
  SellersReport,
  TotalsReport,
} from './dto/report-views.js';
import {
  StoreReportsService,
  type ReportFile,
} from './store-reports.service.js';

/** The answer of an export: never cached, never sniffed as another type. */
function ReportFileResponse(): MethodDecorator {
  return applyDecorators(
    Header('Cache-Control', 'no-store'),
    Header('X-Content-Type-Options', 'nosniff'),
    ApiProduces(
      'application/pdf',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    ),
    ApiOkResponse({
      description: 'Le fichier',
      schema: { type: 'string', format: 'binary' },
    }),
  );
}

/** Bytes already in memory: nothing can fail once the answer has started. */
function toDownload(file: ReportFile): StreamableFile {
  return new StreamableFile(file.content, {
    type: file.contentType,
    disposition: `attachment; filename="${file.fileName}"`,
  });
}

@ApiTags('Mobile - Rapports')
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
  description: 'Quincaillerie introuvable : vous n’en êtes pas membre actif',
  type: ErrorResponse,
})
@ApiBadRequestResponse({
  description:
    'Identifiant de quincaillerie invalide ; paramètres invalides (`details`)',
  type: ErrorResponse,
})
@MobileRoute()
@StoreRoles(['MANAGER'])
@Controller('stores/:storeId/reports')
export class StoreReportsController {
  constructor(private readonly reports: StoreReportsService) {}

  /**
   * @description The store's totals over a period
   * @route GET /api/v1/stores/:storeId/reports/totals
   * @access Store manager (mobile session)
   * @param storeId the store
   * @query ReportPeriodDto (from, to)
   * @returns 200 TotalsReport
   */
  @Get('totals')
  @ApiOperation({
    summary: 'Totaux par période',
    description:
      'Dépôts, corrections, achats et recrédits confirmés sur la période, et les espèces reçues, calculées comme une clôture de caisse. Jours en UTC, un an au plus. Possible quel que soit le statut de la quincaillerie.',
  })
  @ApiOkResponse({ description: 'Totaux', type: TotalsReport })
  totals(
    @CurrentStore() store: CurrentStoreContext,
    @Query() period: ReportPeriodDto,
  ): Promise<TotalsReport> {
    return this.reports.totals(store.storeId, period);
  }

  /**
   * @description The store's totals over a period, as a file
   * @route GET /api/v1/stores/:storeId/reports/totals/export
   * @access Store manager (mobile session)
   * @param storeId the store
   * @query ExportPeriodDto (from, to, format)
   * @returns 200 the file, PDF or Excel
   */
  @Get('totals/export')
  @ReportFileResponse()
  @ApiOperation({
    summary: 'Exporter les totaux',
    description:
      'Les mêmes chiffres que le rapport, en fichier PDF ou Excel. L’export est inscrit au journal.',
  })
  async exportTotals(
    @CurrentStore() store: CurrentStoreContext,
    @CurrentUser() actor: AuthenticatedUser,
    @Query() query: ExportPeriodDto,
  ): Promise<StreamableFile> {
    return toDownload(
      await this.reports.exportTotals(store.storeId, actor, query),
    );
  }

  /**
   * @description The store's active and inactive customers, the quietest first
   * @route GET /api/v1/stores/:storeId/reports/customers
   * @access Store manager (mobile session)
   * @param storeId the store
   * @query CustomersQueryDto (status?, page, pageSize)
   * @returns 200 CustomersReport
   */
  @Get('customers')
  @ApiOperation({
    summary: 'Clients actifs et inactifs',
    description:
      'Un client est actif s’il a fait un dépôt depuis moins de 30 jours, à compter d’aujourd’hui ; un compte ouvert depuis moins de 30 jours compte comme actif. Les clients sans activité depuis le plus longtemps viennent en premier. Possible quel que soit le statut de la quincaillerie.',
  })
  @ApiOkResponse({ description: 'Clients', type: CustomersReport })
  customers(
    @CurrentStore() store: CurrentStoreContext,
    @Query() query: CustomersQueryDto,
  ): Promise<CustomersReport> {
    return this.reports.customers(store.storeId, query);
  }

  /**
   * @description The store's customers matching a filter, as a file, 5,000 rows at most
   * @route GET /api/v1/stores/:storeId/reports/customers/export
   * @access Store manager (mobile session)
   * @param storeId the store
   * @query ExportCustomersDto (status?, format)
   * @returns 200 the file, PDF or Excel; 409 EXPORT_TOO_LARGE
   */
  @Get('customers/export')
  @ReportFileResponse()
  @ApiOperation({
    summary: 'Exporter les clients',
    description:
      'Tous les clients du filtre, pas une seule page, 5 000 lignes au plus, en fichier PDF ou Excel. L’export est inscrit au journal.',
  })
  @ApiConflictResponse({
    description: 'Plus de 5 000 lignes (`EXPORT_TOO_LARGE`)',
    type: ErrorResponse,
  })
  async exportCustomers(
    @CurrentStore() store: CurrentStoreContext,
    @CurrentUser() actor: AuthenticatedUser,
    @Query() query: ExportCustomersDto,
  ): Promise<StreamableFile> {
    return toDownload(
      await this.reports.exportCustomers(store.storeId, actor, query),
    );
  }

  /**
   * @description What each staff member recorded over a period, as a file
   * @route GET /api/v1/stores/:storeId/reports/sellers/export
   * @access Store manager (mobile session)
   * @param storeId the store
   * @query ExportPeriodDto (from, to, format)
   * @returns 200 the file, PDF or Excel
   */
  @Get('sellers/export')
  @ReportFileResponse()
  @ApiOperation({
    summary: 'Exporter l’activité par vendeur',
    description:
      'Les mêmes chiffres que le rapport, en fichier PDF ou Excel. L’export est inscrit au journal.',
  })
  async exportSellers(
    @CurrentStore() store: CurrentStoreContext,
    @CurrentUser() actor: AuthenticatedUser,
    @Query() query: ExportPeriodDto,
  ): Promise<StreamableFile> {
    return toDownload(
      await this.reports.exportSellers(store.storeId, actor, query),
    );
  }

  /**
   * @description What each staff member of the store recorded over a period
   * @route GET /api/v1/stores/:storeId/reports/sellers
   * @access Store manager (mobile session)
   * @param storeId the store
   * @query ReportPeriodDto (from, to)
   * @returns 200 SellersReport
   */
  @Get('sellers')
  @ApiOperation({
    summary: 'Activité par vendeur',
    description:
      'Pour chaque membre de l’équipe : dépôts enregistrés, bons préparés et payés, corrections faites sur ses dépôts. Les membres actifs apparaissent toujours, et les anciens membres s’ils ont une activité sur la période. Jours en UTC, un an au plus. Possible quel que soit le statut de la quincaillerie.',
  })
  @ApiOkResponse({ description: 'Activité', type: SellersReport })
  sellers(
    @CurrentStore() store: CurrentStoreContext,
    @Query() period: ReportPeriodDto,
  ): Promise<SellersReport> {
    return this.reports.sellers(store.storeId, period);
  }
}
