import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import {
  ApiBadGatewayResponse,
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiCookieAuth,
  ApiForbiddenResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import type { AuthenticatedAdmin } from '../admin-auth/authenticated-admin.js';
import { CurrentAdmin } from '../admin-auth/decorators/current-admin.decorator.js';
import { SuperAdminOnly } from '../admin-auth/decorators/require-permission.decorator.js';
import { ErrorResponse } from '../common/errors/error-response.js';
import {
  ApiPaginatedResponse,
  PaginationQueryDto,
  type Paginated,
} from '../common/pagination.js';
import {
  SendWhatsappTestDto,
  UpdateWhatsappSettingsDto,
  WhatsappSettingsChangeView,
  WhatsappSettingsResponse,
  WhatsappTestResponse,
} from './dto/whatsapp-settings.dto.js';
import { WhatsappSettingsService } from './whatsapp-settings.service.js';

@ApiTags('Administration - WhatsApp')
@ApiCookieAuth()
@ApiUnauthorizedResponse({
  description: 'Non connecté, ou mot de passe actuel incorrect',
  type: ErrorResponse,
})
@ApiForbiddenResponse({
  description:
    'Réservé au super administrateur, ou compte bloqué après trop d’échecs',
  type: ErrorResponse,
})
// Where every sign-in code goes: the super admin's only, whatever an ADMIN's role.
@SuperAdminOnly()
@Controller('admin/whatsapp-settings')
export class WhatsappSettingsController {
  constructor(private readonly settings: WhatsappSettingsService) {}

  /**
   * @description Read the WhatsApp settings (never the token)
   * @route GET /api/v1/admin/whatsapp-settings
   * @access Super admin
   * @returns WhatsappSettingsResponse
   */
  @Get()
  @ApiOperation({
    summary: 'Lire les paramètres WhatsApp',
    description:
      'Renvoie l’état de l’envoi par WhatsApp (Green API). Le jeton n’est jamais renvoyé : seulement s’il est enregistré, lisible, et ses 4 derniers caractères.',
  })
  @ApiOkResponse({ description: 'Paramètres', type: WhatsappSettingsResponse })
  get(): Promise<WhatsappSettingsResponse> {
    return this.settings.get();
  }

  /**
   * @description List the saved changes of the WhatsApp settings
   * @route GET /api/v1/admin/whatsapp-settings/changes
   * @access Super admin
   * @query PaginationQueryDto (page?, pageSize?)
   * @returns Paginated<WhatsappSettingsChangeView>, newest first, never the token
   */
  @Get('changes')
  @ApiOperation({
    summary: 'Historique des modifications WhatsApp',
    description:
      'Chaque modification enregistrée, de la plus récente à la plus ancienne : qui, quand, et ce qui a changé. Le jeton n’y figure jamais, seulement s’il a changé et ses 4 derniers caractères.',
  })
  @ApiPaginatedResponse(WhatsappSettingsChangeView, 'Page de modifications')
  changes(
    @Query() query: PaginationQueryDto,
  ): Promise<Paginated<WhatsappSettingsChangeView>> {
    return this.settings.changes(query);
  }

  /**
   * @description Change the WhatsApp settings, re-confirming the password
   * @route PATCH /api/v1/admin/whatsapp-settings
   * @access Super admin
   * @body UpdateWhatsappSettingsDto (currentPassword, enabled?, instanceId?, token?)
   * @returns WhatsappSettingsResponse; each real change is recorded and opens an admin alert
   */
  @Patch()
  @ApiOperation({
    summary: 'Modifier les paramètres WhatsApp',
    description:
      'Mise à jour partielle, confirmée par le mot de passe actuel (un mot de passe erroné compte dans le blocage de connexion). Chaque modification est enregistrée (qui, quand, quoi) et crée une alerte visible du seul super administrateur ; enregistrer les mêmes valeurs ne crée rien.',
  })
  @ApiOkResponse({
    description: 'Paramètres enregistrés',
    type: WhatsappSettingsResponse,
  })
  @ApiBadRequestResponse({
    description: 'Valeur invalide',
    type: ErrorResponse,
  })
  @ApiConflictResponse({
    description:
      'WHATSAPP_NOT_CONFIGURED (WhatsApp activé, ou laissé activé, sans identifiant ou jeton lisible) ou ENCRYPTION_KEY_MISSING (clé de chiffrement absente du serveur)',
    type: ErrorResponse,
  })
  update(
    @Body() body: UpdateWhatsappSettingsDto,
    @CurrentAdmin() current: AuthenticatedAdmin,
  ): Promise<WhatsappSettingsResponse> {
    return this.settings.update(body, current.adminId);
  }

  /**
   * @description Send a test WhatsApp message with the saved instance and token
   * @route POST /api/v1/admin/whatsapp-settings/test
   * @access Super admin
   * @body SendWhatsappTestDto (phone)
   * @returns WhatsappTestResponse; 409 not configured; 502 Green API failed
   */
  @Post('test')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Envoyer un message WhatsApp de test',
    description:
      'Envoie un message de test fixe au numéro donné (pays actif) avec l’instance et le jeton enregistrés, même si WhatsApp est désactivé, pour les vérifier avant de l’activer. Ne modifie et n’enregistre rien.',
  })
  @ApiOkResponse({ description: 'Message envoyé', type: WhatsappTestResponse })
  @ApiBadRequestResponse({
    description: 'Numéro invalide',
    type: ErrorResponse,
  })
  @ApiConflictResponse({
    description:
      'WHATSAPP_NOT_CONFIGURED : identifiant d’instance ou jeton lisible manquant',
    type: ErrorResponse,
  })
  @ApiBadGatewayResponse({
    description:
      'WHATSAPP_SEND_FAILED : Green API a refusé ou n’a pas répondu (la cause est dans le message)',
    type: ErrorResponse,
  })
  async sendTest(
    @Body() body: SendWhatsappTestDto,
  ): Promise<WhatsappTestResponse> {
    await this.settings.sendTest(body.phone);
    return { sent: true };
  }
}
