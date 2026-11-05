import {
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
import { invalidAlertId } from './admin-alerts.errors.js';
import { AdminAlertsService } from './admin-alerts.service.js';
import { AdminAlertsQueryDto, AdminAlertView } from './dto/admin-alert.dto.js';

const AlertIdPipe = new ParseUUIDPipe({ exceptionFactory: invalidAlertId });

@ApiTags('Administration - Alertes')
@ApiCookieAuth()
@ApiUnauthorizedResponse({ description: 'Non connecté', type: ErrorResponse })
@ApiForbiddenResponse({
  description: 'Permission manquante',
  type: ErrorResponse,
})
@Controller('admin/alerts')
export class AdminAlertsController {
  constructor(private readonly alerts: AdminAlertsService) {}

  /**
   * @description List the alerts found by the scheduled jobs, newest first
   * @route GET /api/v1/admin/alerts
   * @access Admin with alerts.read
   * @query status (open | resolved | all, default open), type, page, pageSize
   * @returns Paginated AdminAlertView
   */
  @Get()
  @RequirePermission('alerts.read')
  @ApiOperation({
    summary: 'Alertes de la plateforme',
    description:
      'Les écarts trouvés par la vérification nocturne des soldes (chaque nuit à 2 h UTC), les plus récents d’abord. Chaque alerte nomme la quincaillerie, le compte et l’écart, jamais un solde. Par défaut, seulement les alertes à traiter.',
  })
  @ApiPaginatedResponse(AdminAlertView, 'Page d’alertes')
  @ApiBadRequestResponse({
    description: 'Filtre invalide (`details`)',
    type: ErrorResponse,
  })
  list(
    @Query() query: AdminAlertsQueryDto,
  ): Promise<Paginated<AdminAlertView>> {
    return this.alerts.list(query);
  }

  /**
   * @description Mark an alert resolved, once an admin has looked into it
   * @route PATCH /api/v1/admin/alerts/:id/resolve
   * @access Admin with alerts.manage
   * @param id (UUID) alert id
   * @returns 200 AdminAlertView; 404 unknown; 409 ALERT_ALREADY_RESOLVED
   */
  @Patch(':id/resolve')
  @RequirePermission('alerts.manage')
  @ApiOperation({
    summary: 'Marquer une alerte comme traitée',
    description:
      'Enregistre qui l’a traitée et quand. Ne change aucun solde : une correction reste au gérant. Si l’écart est toujours là, la vérification de la nuit suivante crée une nouvelle alerte.',
  })
  @ApiParam({ name: 'id', description: 'Identifiant de l’alerte' })
  @ApiOkResponse({ description: 'Alerte traitée', type: AdminAlertView })
  @ApiBadRequestResponse({
    description: 'Identifiant invalide',
    type: ErrorResponse,
  })
  @ApiNotFoundResponse({
    description: 'Alerte introuvable',
    type: ErrorResponse,
  })
  @ApiConflictResponse({
    description: 'Alerte déjà traitée (`ALERT_ALREADY_RESOLVED`)',
    type: ErrorResponse,
  })
  resolve(
    @Param('id', AlertIdPipe) id: string,
    @CurrentAdmin() current: AuthenticatedAdmin,
  ): Promise<AdminAlertView> {
    return this.alerts.resolve(id, current.adminId);
  }
}
