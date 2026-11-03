import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
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
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { SuperAdminOnly } from '../admin-auth/decorators/require-permission.decorator.js';
import { ErrorResponse } from '../common/errors/error-response.js';
import { invalidRoleId } from './admin-roles.errors.js';
import { AdminRolesService } from './admin-roles.service.js';
import {
  CreateRoleDto,
  PermissionView,
  RoleView,
  UpdateRoleDto,
} from './dto/role.dto.js';

const RoleIdPipe = new ParseUUIDPipe({ exceptionFactory: invalidRoleId });

@ApiTags('Administration - Rôles')
@ApiCookieAuth()
@ApiUnauthorizedResponse({ description: 'Non connecté', type: ErrorResponse })
@ApiForbiddenResponse({
  description: 'Réservé au super administrateur',
  type: ErrorResponse,
})
// Only the super admin: a role manager could give themselves every permission.
@SuperAdminOnly()
@Controller('admin')
export class AdminRolesController {
  constructor(private readonly roles: AdminRolesService) {}

  /**
   * @description List the permissions a role can hold, with what each allows
   * @route GET /api/v1/admin/permissions
   * @access Super admin
   * @returns 200 PermissionView[]
   */
  @Get('permissions')
  @ApiOperation({
    summary: 'Lister les permissions',
    description:
      'Les permissions qu’un rôle peut donner. La gestion des administrateurs et des rôles reste au super administrateur.',
  })
  @ApiOkResponse({ description: 'Permissions', type: [PermissionView] })
  permissions(): PermissionView[] {
    return this.roles.permissions();
  }

  /**
   * @description List the roles, with their permissions and number of admins
   * @route GET /api/v1/admin/roles
   * @access Super admin
   * @returns 200 RoleView[]
   */
  @Get('roles')
  @ApiOperation({ summary: 'Lister les rôles' })
  @ApiOkResponse({ description: 'Rôles', type: [RoleView] })
  list(): Promise<RoleView[]> {
    return this.roles.list();
  }

  /**
   * @description Create a role with a set of permissions
   * @route POST /api/v1/admin/roles
   * @access Super admin
   * @body CreateRoleDto (name, permissions)
   * @returns 201 RoleView; 409 ROLE_NAME_TAKEN
   */
  @Post('roles')
  @ApiOperation({ summary: 'Créer un rôle' })
  @ApiCreatedResponse({ description: 'Rôle créé', type: RoleView })
  @ApiBadRequestResponse({
    description: 'Nom ou permission invalide (`details`)',
    type: ErrorResponse,
  })
  @ApiConflictResponse({
    description: 'Un rôle porte déjà ce nom (`ROLE_NAME_TAKEN`)',
    type: ErrorResponse,
  })
  create(@Body() body: CreateRoleDto): Promise<RoleView> {
    return this.roles.create(body);
  }

  /**
   * @description Rename a role or change its permissions
   * @route PATCH /api/v1/admin/roles/:roleId
   * @access Super admin
   * @param roleId the role
   * @body UpdateRoleDto (name?, permissions?)
   * @returns 200 RoleView; 404; 409 ROLE_NAME_TAKEN
   */
  @Patch('roles/:roleId')
  @ApiOperation({
    summary: 'Modifier un rôle',
    description:
      'Les nouvelles permissions remplacent les précédentes et s’appliquent dès la requête suivante de chaque administrateur du rôle.',
  })
  @ApiParam({ name: 'roleId', description: 'Identifiant du rôle' })
  @ApiOkResponse({ description: 'Rôle modifié', type: RoleView })
  @ApiBadRequestResponse({
    description: 'Identifiant, nom ou permission invalide (`details`)',
    type: ErrorResponse,
  })
  @ApiNotFoundResponse({ description: 'Rôle introuvable', type: ErrorResponse })
  @ApiConflictResponse({
    description: 'Un rôle porte déjà ce nom (`ROLE_NAME_TAKEN`)',
    type: ErrorResponse,
  })
  update(
    @Param('roleId', RoleIdPipe) roleId: string,
    @Body() body: UpdateRoleDto,
  ): Promise<RoleView> {
    return this.roles.update(roleId, body);
  }

  /**
   * @description Delete a role that no admin holds
   * @route DELETE /api/v1/admin/roles/:roleId
   * @access Super admin
   * @param roleId the role
   * @returns 204; 404; 409 ROLE_IN_USE
   */
  @Delete('roles/:roleId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Supprimer un rôle' })
  @ApiParam({ name: 'roleId', description: 'Identifiant du rôle' })
  @ApiNoContentResponse({ description: 'Rôle supprimé' })
  @ApiBadRequestResponse({
    description: 'Identifiant invalide',
    type: ErrorResponse,
  })
  @ApiNotFoundResponse({ description: 'Rôle introuvable', type: ErrorResponse })
  @ApiConflictResponse({
    description: 'Des administrateurs ont ce rôle (`ROLE_IN_USE`)',
    type: ErrorResponse,
  })
  remove(@Param('roleId', RoleIdPipe) roleId: string): Promise<void> {
    return this.roles.remove(roleId);
  }
}
