import { Controller, Get, Query } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
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
import { ActivityLogService } from './activity-log.service.js';
import { ActivityEntry } from './dto/activity-entry.js';

@ApiTags('Mobile - Journal d’activité')
@ApiBearerAuth()
@MobileRoute()
@Controller('stores/:storeId/activity')
export class ActivityLogController {
  constructor(private readonly activity: ActivityLogService) {}

  /**
   * @description Read the store's activity log, newest first
   * @route GET /api/v1/stores/:storeId/activity
   * @access Store manager (mobile session)
   * @param storeId the store
   * @query PaginationQueryDto (page, pageSize)
   * @returns 200 Paginated<ActivityEntry>
   */
  @Get()
  @StoreRoles(['MANAGER'])
  @ApiOperation({
    summary: 'Journal d’activité de la quincaillerie',
    description:
      'Qui a fait quoi, depuis quel appareil et quand, du plus récent au plus ancien. Seulement les actions de cette quincaillerie.',
  })
  @ApiParam({ name: 'storeId', description: 'Identifiant de la quincaillerie' })
  @ApiPaginatedResponse(ActivityEntry, 'Page du journal')
  @ApiBadRequestResponse({
    description:
      'Identifiant de quincaillerie invalide ; pagination invalide (`details`)',
    type: ErrorResponse,
  })
  @ApiUnauthorizedResponse({
    description: 'Session absente, expirée ou fermée',
    type: ErrorResponse,
  })
  @ApiForbiddenResponse({
    description:
      'Membre de la quincaillerie sans le rôle de gérant (`STORE_ROLE_REQUIRED`)',
    type: ErrorResponse,
  })
  @ApiNotFoundResponse({
    description: 'Quincaillerie introuvable : vous n’en êtes pas membre actif',
    type: ErrorResponse,
  })
  list(
    @CurrentStore() store: CurrentStoreContext,
    @Query() query: PaginationQueryDto,
  ): Promise<Paginated<ActivityEntry>> {
    return this.activity.list(store.storeId, query);
  }
}
