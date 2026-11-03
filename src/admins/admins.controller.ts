import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiCookieAuth,
  ApiCreatedResponse,
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
import { SuperAdminOnly } from '../admin-auth/decorators/require-permission.decorator.js';
import { ErrorResponse } from '../common/errors/error-response.js';
import { invalidAdminId } from './admins.errors.js';
import { AdminsService } from './admins.service.js';
import { AdminSummary } from './dto/admin-summary.js';
import { CreateAdminDto } from './dto/create-admin.dto.js';
import { AssignRoleDto } from '../admin-roles/dto/role.dto.js';

// French error for a malformed id instead of Nest's "Validation failed (uuid is expected)".
const AdminIdPipe = new ParseUUIDPipe({ exceptionFactory: invalidAdminId });

@ApiTags('Administration - Administrateurs')
@ApiCookieAuth()
@ApiUnauthorizedResponse({ description: 'Non connecté', type: ErrorResponse })
@ApiForbiddenResponse({
  description: 'Réservé au super administrateur',
  type: ErrorResponse,
})
// Every route of this controller is super-admin only.
@SuperAdminOnly()
@Controller('admin/admins')
export class AdminsController {
  constructor(private readonly admins: AdminsService) {}

  /**
   * @description Create an ADMIN account with an initial password
   * @route POST /api/v1/admin/admins
   * @access Super admin
   * @body CreateAdminDto (email, firstName, lastName, password, roleId)
   * @returns 201 AdminSummary; the new admin must change the password at first login
   */
  @Post()
  @ApiOperation({
    summary: 'Créer un administrateur',
    description:
      'Crée un compte ADMIN avec un mot de passe initial. L’administrateur devra le changer à sa première connexion avant d’accéder au reste de l’API.',
  })
  @ApiCreatedResponse({
    description: 'Administrateur créé',
    type: AdminSummary,
  })
  @ApiBadRequestResponse({
    description: 'Données invalides',
    type: ErrorResponse,
  })
  @ApiConflictResponse({
    description: 'Email déjà utilisé (`EMAIL_ALREADY_USED`)',
    type: ErrorResponse,
  })
  create(
    @Body() body: CreateAdminDto,
    @CurrentAdmin() current: AuthenticatedAdmin,
  ): Promise<AdminSummary> {
    return this.admins.create(body, current.adminId);
  }

  /**
   * @description List all admins, newest first
   * @route GET /api/v1/admin/admins
   * @access Super admin
   * @returns AdminSummary[]
   */
  @Get()
  @ApiOperation({
    summary: 'Lister les administrateurs',
    description: 'Tous les administrateurs, du plus récent au plus ancien.',
  })
  @ApiOkResponse({ description: 'Liste', type: [AdminSummary] })
  list(): Promise<AdminSummary[]> {
    return this.admins.list();
  }

  /**
   * @description Deactivate an admin: blocks login and ends all their sessions
   * @route PATCH /api/v1/admin/admins/:id/deactivate
   * @access Super admin
   * @param id (UUID) admin id; not yourself, not a super admin
   * @returns AdminSummary
   */
  @Patch(':id/deactivate')
  @ApiOperation({
    summary: 'Désactiver un administrateur',
    description:
      'Bloque la connexion et ferme immédiatement toutes ses sessions. Impossible sur votre propre compte ou sur un super administrateur.',
  })
  @ApiParam({ name: 'id', description: 'Identifiant de l’administrateur' })
  @ApiOkResponse({
    description: 'Administrateur désactivé',
    type: AdminSummary,
  })
  @ApiBadRequestResponse({
    description: 'Identifiant invalide',
    type: ErrorResponse,
  })
  @ApiNotFoundResponse({
    description: 'Administrateur introuvable',
    type: ErrorResponse,
  })
  deactivate(
    @Param('id', AdminIdPipe) id: string,
    @CurrentAdmin() current: AuthenticatedAdmin,
  ): Promise<AdminSummary> {
    return this.admins.deactivate(id, current.adminId);
  }

  /**
   * @description Give an admin another role; it counts from their next request
   * @route PATCH /api/v1/admin/admins/:id/role
   * @access Super admin
   * @param id (UUID) admin id
   * @body AssignRoleDto (roleId)
   * @returns AdminSummary; 404 admin or role; 409 SUPER_ADMIN_HAS_NO_ROLE
   */
  @Patch(':id/role')
  @ApiOperation({
    summary: 'Changer le rôle d’un administrateur',
    description:
      'Le nouveau rôle s’applique dès sa requête suivante, sans qu’il ait à se reconnecter. Le super administrateur a toutes les permissions et n’a pas de rôle.',
  })
  @ApiParam({ name: 'id', description: 'Identifiant de l’administrateur' })
  @ApiOkResponse({ description: 'Rôle changé', type: AdminSummary })
  @ApiBadRequestResponse({
    description: 'Identifiant invalide (`details`)',
    type: ErrorResponse,
  })
  @ApiNotFoundResponse({
    description: 'Administrateur ou rôle introuvable',
    type: ErrorResponse,
  })
  @ApiConflictResponse({
    description:
      'Le super administrateur n’a pas de rôle (`SUPER_ADMIN_HAS_NO_ROLE`)',
    type: ErrorResponse,
  })
  assignRole(
    @Param('id', AdminIdPipe) id: string,
    @Body() body: AssignRoleDto,
  ): Promise<AdminSummary> {
    return this.admins.assignRole(id, body.roleId);
  }

  /**
   * @description Reactivate a deactivated admin
   * @route PATCH /api/v1/admin/admins/:id/activate
   * @access Super admin
   * @param id (UUID) admin id; not yourself, not a super admin
   * @returns AdminSummary
   */
  @Patch(':id/activate')
  @ApiOperation({
    summary: 'Réactiver un administrateur',
    description:
      'Autorise de nouveau la connexion. Impossible sur votre propre compte ou sur un super administrateur.',
  })
  @ApiParam({ name: 'id', description: 'Identifiant de l’administrateur' })
  @ApiOkResponse({ description: 'Administrateur réactivé', type: AdminSummary })
  @ApiBadRequestResponse({
    description: 'Identifiant invalide',
    type: ErrorResponse,
  })
  @ApiNotFoundResponse({
    description: 'Administrateur introuvable',
    type: ErrorResponse,
  })
  activate(
    @Param('id', AdminIdPipe) id: string,
    @CurrentAdmin() current: AuthenticatedAdmin,
  ): Promise<AdminSummary> {
    return this.admins.activate(id, current.adminId);
  }
}
