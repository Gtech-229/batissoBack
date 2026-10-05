import { Body, Controller, Get, Patch } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiCookieAuth,
  ApiForbiddenResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import type { AuthenticatedAdmin } from '../admin-auth/authenticated-admin.js';
import { CurrentAdmin } from '../admin-auth/decorators/current-admin.decorator.js';
import { Roles } from '../admin-auth/decorators/roles.decorator.js';
import { ErrorResponse } from '../common/errors/error-response.js';
import {
  SystemSettingsResponse,
  UpdateSystemSettingsDto,
} from './dto/system-settings.dto.js';
import { SystemSettingsService } from './system-settings.service.js';

@ApiTags('Administration - Paramètres système')
@ApiCookieAuth()
@ApiUnauthorizedResponse({ description: 'Non connecté', type: ErrorResponse })
@Controller('admin/settings')
export class SystemSettingsController {
  constructor(private readonly settings: SystemSettingsService) {}

  /**
   * @description Read the system settings (defaults until a first save)
   * @route GET /api/v1/admin/settings
   * @access Admin
   * @returns SystemSettingsResponse
   */
  @Get()
  @ApiOperation({
    summary: 'Lire les paramètres système',
    description:
      'Renvoie les valeurs en vigueur, ou les valeurs par défaut si aucun paramètre n’a encore été enregistré.',
  })
  @ApiOkResponse({ description: 'Paramètres', type: SystemSettingsResponse })
  get(): Promise<SystemSettingsResponse> {
    return this.settings.get();
  }

  /**
   * @description Update one or more system settings
   * @route PATCH /api/v1/admin/settings
   * @access Super admin
   * @body UpdateSystemSettingsDto (maxLoginAttempts?, maxAdminSessions?)
   * @returns SystemSettingsResponse; applies from the next login
   */
  @Patch()
  @Roles(['SUPER_ADMIN'])
  @ApiOperation({
    summary: 'Modifier les paramètres système',
    description:
      'Mise à jour partielle : les paramètres absents gardent leur valeur. Les nouvelles valeurs s’appliquent dès la prochaine connexion.',
  })
  @ApiOkResponse({
    description: 'Paramètres enregistrés',
    type: SystemSettingsResponse,
  })
  @ApiBadRequestResponse({
    description: 'Valeur hors limites',
    type: ErrorResponse,
  })
  @ApiForbiddenResponse({
    description: 'Réservé au super administrateur',
    type: ErrorResponse,
  })
  update(
    @Body() body: UpdateSystemSettingsDto,
    @CurrentAdmin() current: AuthenticatedAdmin,
  ): Promise<SystemSettingsResponse> {
    return this.settings.update(body, current.adminId);
  }
}
