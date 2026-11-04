import { Controller, Get, Query } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiCookieAuth,
  ApiForbiddenResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { RequirePermission } from '../admin-auth/decorators/require-permission.decorator.js';
import { ErrorResponse } from '../common/errors/error-response.js';
import { ApiPaginatedResponse, type Paginated } from '../common/pagination.js';
import { ActivityLogService } from './activity-log.service.js';
import {
  AdminActivityEntry,
  AdminActivityQueryDto,
} from './dto/admin-activity.dto.js';

@ApiTags('Administration - Journal d’activité')
@ApiCookieAuth()
@ApiUnauthorizedResponse({ description: 'Non connecté', type: ErrorResponse })
@ApiForbiddenResponse({
  description: 'Permission manquante',
  type: ErrorResponse,
})
@Controller('admin/activity')
export class AdminActivityController {
  constructor(private readonly activity: ActivityLogService) {}

  /**
   * @description Read every store's activity log, newest first
   * @route GET /api/v1/admin/activity
   * @access Admin with activity.read
   * @query storeId, action, from, to (YYYY-MM-DD, both included), page, pageSize
   * @returns Paginated AdminActivityEntry; 400 INVALID_PERIOD
   */
  @Get()
  @RequirePermission('activity.read')
  @ApiOperation({
    summary: 'Journal d’activité des quincailleries',
    description:
      'Les actions enregistrées dans toutes les quincailleries, les plus récentes d’abord, chacune avec sa quincaillerie, telles que le gérant les voit. Filtrable par quincaillerie, par action et par période (jours UTC inclus). Lecture seule.',
  })
  @ApiPaginatedResponse(AdminActivityEntry, 'Page du journal')
  @ApiBadRequestResponse({
    description:
      'Filtre invalide (`details`) ou dernier jour avant le premier (`INVALID_PERIOD`)',
    type: ErrorResponse,
  })
  list(
    @Query() query: AdminActivityQueryDto,
  ): Promise<Paginated<AdminActivityEntry>> {
    return this.activity.listAll(query);
  }
}
