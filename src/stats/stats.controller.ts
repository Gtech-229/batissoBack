import { Controller, Get, Query } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiCookieAuth,
  ApiForbiddenResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { RequirePermission } from '../admin-auth/decorators/require-permission.decorator.js';
import { ErrorResponse } from '../common/errors/error-response.js';
import { ReportPeriodDto } from '../store-reports/dto/report-period.dto.js';
import { PlatformStats } from './dto/platform-stats.dto.js';
import { StatsService } from './stats.service.js';

@ApiTags('Administration - Statistiques')
@ApiCookieAuth()
@ApiUnauthorizedResponse({ description: 'Non connecté', type: ErrorResponse })
@ApiForbiddenResponse({
  description: 'Permission manquante',
  type: ErrorResponse,
})
@Controller('admin/stats')
export class StatsController {
  constructor(private readonly stats: StatsService) {}

  /**
   * @description The platform's figures over a period, in total and per country
   * @route GET /api/v1/admin/stats
   * @access Admin with stats.read
   * @query from, to (YYYY-MM-DD, UTC, both included, 366 days at most)
   * @returns PlatformStats (counts only, never amounts)
   */
  @Get()
  @RequirePermission('stats.read')
  @ApiOperation({
    summary: 'Statistiques de la plateforme',
    description:
      'Des comptes, jamais des montants, pour toute la plateforme et pour chaque pays qui a au moins une quincaillerie. Les chiffres « à la date de la demande » (quincailleries par statut et par abonnement, comptes) ne dépendent pas de la période ; les autres comptent ce qui s’est passé du premier au dernier jour inclus (UTC, 366 jours au plus). Lecture seule.',
  })
  @ApiOkResponse({ description: 'Statistiques', type: PlatformStats })
  @ApiBadRequestResponse({
    description: 'Période absente ou invalide (`details`)',
    type: ErrorResponse,
  })
  read(@Query() period: ReportPeriodDto): Promise<PlatformStats> {
    return this.stats.stats(period);
  }
}
