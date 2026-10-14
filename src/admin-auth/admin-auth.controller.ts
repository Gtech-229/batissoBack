import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Patch,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  ApiBadRequestResponse,
  ApiCookieAuth,
  ApiForbiddenResponse,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { ErrorResponse } from '../common/errors/error-response.js';
import {
  Environment,
  type EnvironmentVariables,
} from '../config/env.validation.js';
import { REFRESH_COOKIE } from './admin-auth.constants.js';
import { AdminAuthService } from './admin-auth.service.js';
import type { AuthenticatedAdmin } from './authenticated-admin.js';
import { clearSessionCookies, setSessionCookies } from './cookies.js';
import { AllowWhilePasswordChangeRequired } from './decorators/allow-while-password-change-required.decorator.js';
import { CurrentAdmin } from './decorators/current-admin.decorator.js';
import { Public } from './decorators/public.decorator.js';
import { ChangePasswordDto } from './dto/change-password.dto.js';
import { AdminProfile } from './dto/admin-profile.js';
import { LoginDto } from './dto/login.dto.js';

@ApiTags('Administration - Authentification')
@Controller('admin/auth')
export class AdminAuthController {
  // Secure cookies need HTTPS, which local development does not have.
  private readonly secureCookies: boolean;

  constructor(
    private readonly auth: AdminAuthService,
    config: ConfigService<EnvironmentVariables, true>,
  ) {
    this.secureCookies =
      config.get('NODE_ENV', { infer: true }) === Environment.Production;
  }

  /**
   * @description Login as admin: checks email and password, opens a session
   * @route POST /api/v1/admin/auth/login
   * @access Public
   * @body LoginDto (email, password)
   * @returns AdminProfile, sets the access and refresh cookies
   */
  @Post('login')
  @Public()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Se connecter',
    description:
      'Vérifie l’email et le mot de passe, ouvre une session et dépose les cookies httpOnly `batisso_admin_access` et `batisso_admin_refresh`. Aucun jeton n’est renvoyé dans le corps.',
  })
  @ApiOkResponse({ description: 'Connexion réussie', type: AdminProfile })
  @ApiBadRequestResponse({
    description: 'Données invalides',
    type: ErrorResponse,
  })
  @ApiUnauthorizedResponse({
    description: 'Email ou mot de passe incorrect (`INVALID_CREDENTIALS`)',
    type: ErrorResponse,
  })
  @ApiForbiddenResponse({
    description:
      'Compte bloqué après trop d’échecs (`ACCOUNT_LOCKED`) ou désactivé (`ACCOUNT_DISABLED`)',
    type: ErrorResponse,
  })
  async login(
    @Body() body: LoginDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AdminProfile> {
    const { profile, cookies } = await this.auth.login(
      body.email,
      body.password,
      req.headers['user-agent'],
    );
    setSessionCookies(res, cookies, this.secureCookies);
    return profile;
  }

  /**
   * @description Renew the session: rotates the refresh token
   * @route POST /api/v1/admin/auth/refresh
   * @access Public (needs a valid refresh cookie)
   * @cookie batisso_admin_refresh
   * @returns 204, sets new access and refresh cookies (cleared on failure)
   */
  @Post('refresh')
  @Public()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Renouveler la session',
    description:
      'Utilise le cookie `batisso_admin_refresh` pour déposer de nouveaux cookies. L’ancien jeton de renouvellement devient inutilisable.',
  })
  @ApiNoContentResponse({ description: 'Session renouvelée' })
  @ApiUnauthorizedResponse({
    description:
      'Session absente, expirée ou révoquée (`INVALID_REFRESH_TOKEN`)',
    type: ErrorResponse,
  })
  async refresh(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<void> {
    try {
      const cookies = await this.auth.refresh(req.cookies?.[REFRESH_COOKIE]);
      setSessionCookies(res, cookies, this.secureCookies);
    } catch (error) {
      // A dead session: remove its cookies so the browser stops sending them.
      clearSessionCookies(res, this.secureCookies);
      throw error;
    }
  }

  /**
   * @description Logout: revokes the session of the refresh cookie
   * @route POST /api/v1/admin/auth/logout
   * @access Public (works even after the access token expired)
   * @cookie batisso_admin_refresh
   * @returns 204, clears the cookies
   */
  @Post('logout')
  @Public()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Se déconnecter',
    description:
      'Révoque la session liée au cookie `batisso_admin_refresh` et supprime les cookies. Répond 204 même si la session était déjà terminée.',
  })
  @ApiNoContentResponse({ description: 'Déconnexion effectuée' })
  async logout(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<void> {
    await this.auth.logout(req.cookies?.[REFRESH_COOKIE]);
    clearSessionCookies(res, this.secureCookies);
  }

  /**
   * @description Profile of the logged-in admin
   * @route GET /api/v1/admin/auth/me
   * @access Admin (allowed while a password change is required)
   * @cookie batisso_admin_access
   * @returns AdminProfile
   */
  @Get('me')
  @AllowWhilePasswordChangeRequired()
  @ApiCookieAuth()
  @ApiOperation({
    summary: 'Mon profil',
    description:
      'Renvoie le profil de l’administrateur connecté. Accessible même si le mot de passe doit être changé (voir `mustChangePassword`).',
  })
  @ApiOkResponse({ description: 'Profil', type: AdminProfile })
  @ApiUnauthorizedResponse({
    description: 'Non connecté ou session terminée',
    type: ErrorResponse,
  })
  me(@CurrentAdmin() admin: AuthenticatedAdmin): Promise<AdminProfile> {
    return this.auth.me(admin.adminId);
  }

  /**
   * @description Change my password; required on first login for new admins
   * @route PATCH /api/v1/admin/auth/password
   * @access Admin (allowed while a password change is required)
   * @cookie batisso_admin_access
   * @body ChangePasswordDto (currentPassword, newPassword)
   * @returns 204, other sessions of this admin are signed out; 401 INVALID_CREDENTIALS; 403 ACCOUNT_LOCKED (shared login lockout)
   */
  @Patch('password')
  @HttpCode(HttpStatus.NO_CONTENT)
  @AllowWhilePasswordChangeRequired()
  @ApiCookieAuth()
  @ApiOperation({
    summary: 'Changer mon mot de passe',
    description:
      'Vérifie le mot de passe actuel, enregistre le nouveau et déconnecte les autres sessions de l’administrateur. La session courante reste ouverte. Un mot de passe actuel faux compte dans le même blocage que la connexion : après trop d’erreurs, le compte est bloqué 15 minutes.',
  })
  @ApiNoContentResponse({ description: 'Mot de passe changé' })
  @ApiBadRequestResponse({
    description: 'Nouveau mot de passe non conforme ou identique à l’actuel',
    type: ErrorResponse,
  })
  @ApiUnauthorizedResponse({
    description:
      'Mot de passe actuel incorrect (`INVALID_CREDENTIALS`) ou non connecté',
    type: ErrorResponse,
  })
  @ApiForbiddenResponse({
    description:
      'Compte bloqué après trop d’erreurs de mot de passe (`ACCOUNT_LOCKED`)',
    type: ErrorResponse,
  })
  changePassword(
    @CurrentAdmin() admin: AuthenticatedAdmin,
    @Body() body: ChangePasswordDto,
  ): Promise<void> {
    return this.auth.changePassword(
      admin.adminId,
      admin.sessionId,
      body.currentPassword,
      body.newPassword,
    );
  }
}
