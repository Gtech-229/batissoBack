import { Controller, Get, Query } from '@nestjs/common';
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
import { ErrorResponse } from '../common/errors/error-response.js';
import { MobileRoute } from '../mobile-auth/decorators/mobile-route.decorator.js';
import type { CurrentStoreContext } from '../store-access/current-store.js';
import { CurrentStore } from '../store-access/decorators/current-store.decorator.js';
import { StoreRoles } from '../store-access/decorators/store-roles.decorator.js';
import { ReportPeriodDto } from './dto/report-period.dto.js';
import {
  CustomersQueryDto,
  CustomersReport,
  SellersReport,
  TotalsReport,
} from './dto/report-views.js';
import { StoreReportsService } from './store-reports.service.js';

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
