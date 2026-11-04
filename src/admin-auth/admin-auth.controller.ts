import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Patch,
  Post,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  ApiAcceptedResponse,
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
import { OwnAccountRoute } from './decorators/own-account-route.decorator.js';
import { CurrentAdmin } from './decorators/current-admin.decorator.js';
import { Public } from './decorators/public.decorator.js';
import { ChangePasswordDto } from './dto/change-password.dto.js';
import { AdminProfile, MyAdminProfile } from './dto/admin-profile.js';
import { LoginDto } from './dto/login.dto.js';
import {
  ForgotPasswordDto,
  PasswordLinkQuery,
  PasswordLinkRequested,
  ResetPasswordDto,
} from './dto/password-link.dto.js';
import {
  PASSWORD_LINK_REQUESTED,
  PasswordLinksService,
} from './password-links.service.js';

@ApiTags('Administration - Authentification')
@Controller('admin/auth')
export class AdminAuthController {
  // Secure cookies need HTTPS, which local development does not have.
  private readonly secureCookies: boolean;

  constructor(
    private readonly auth: AdminAuthService,
    private readonly links: PasswordLinksService,
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
   * @description Ask for a password link by email: set a first password or reset a forgotten one
   * @route POST /api/v1/admin/auth/forgot-password
   * @access Public
   * @query mode set | reset
   * @body ForgotPasswordDto (email)
   * @returns 202 PasswordLinkRequested, the same whatever the email
   */
  @Post('forgot-password')
  @Public()
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({
    summary: 'Demander un lien de mot de passe',
    description:
      'Envoie par email un lien valable 3 jours, à usage unique : `mode=set` pour un administrateur qui n’a pas encore de mot de passe, `mode=reset` pour un mot de passe oublié. La réponse est toujours la même, que l’email ait un compte ou non : aucun email n’est envoyé si le compte n’existe pas, est désactivé, ne correspond pas au mode, ou a reçu un lien il y a moins d’une minute. Un nouveau lien remplace le précédent.',
  })
  @ApiAcceptedResponse({
    description: 'Demande prise en compte',
    type: PasswordLinkRequested,
  })
  @ApiBadRequestResponse({
    description: 'Mode ou email invalide (`details`)',
    type: ErrorResponse,
  })
  async forgotPassword(
    @Query() query: PasswordLinkQuery,
    @Body() body: ForgotPasswordDto,
  ): Promise<PasswordLinkRequested> {
    await this.links.request(query.mode, body.email);
    return { message: PASSWORD_LINK_REQUESTED };
  }

  /**
   * @description Choose a password with the token of an emailed link
   * @route POST /api/v1/admin/auth/reset-password
   * @access Public (needs the token of a valid link)
   * @body ResetPasswordDto (token, password)
   * @returns 204, every session of the admin ends and the lockout is cleared; 400 INVALID_PASSWORD_TOKEN
   */
  @Post('reset-password')
  @Public()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Choisir mon mot de passe depuis un lien',
    description:
      'Utilise le jeton du lien reçu par email (`set` ou `reset`) pour enregistrer le mot de passe. Toutes les sessions de l’administrateur sont fermées et le blocage après erreurs est levé ; il se connecte ensuite avec le nouveau mot de passe.',
  })
  @ApiNoContentResponse({ description: 'Mot de passe enregistré' })
  @ApiBadRequestResponse({
    description:
      'Lien invalide, expiré, déjà utilisé ou remplacé, ou compte désactivé (`INVALID_PASSWORD_TOKEN`) ; mot de passe non conforme (`details`)',
    type: ErrorResponse,
  })
  resetPassword(@Body() body: ResetPasswordDto): Promise<void> {
    return this.links.usePasswordToken(body.token, body.password);
  }

  /**
   * @description Profile of the logged-in admin
   * @route GET /api/v1/admin/auth/me
   * @access Admin (own account, whatever the role)
   * @cookie batisso_admin_access
   * @returns MyAdminProfile
   */
  @Get('me')
  @OwnAccountRoute()
  @ApiCookieAuth()
  @ApiOperation({
    summary: 'Mon profil',
    description:
      'Renvoie le profil de l’administrateur connecté et ses permissions. Ouvert à tout administrateur, quel que soit son rôle.',
  })
  @ApiOkResponse({ description: 'Profil', type: MyAdminProfile })
  @ApiUnauthorizedResponse({
    description: 'Non connecté ou session terminée',
    type: ErrorResponse,
  })
  async me(@CurrentAdmin() admin: AuthenticatedAdmin): Promise<MyAdminProfile> {
    // The permissions the guard just read, so the answer matches this request.
    const profile = await this.auth.me(admin.adminId);
    return {
      id: profile.id,
      email: profile.email,
      firstName: profile.firstName,
      lastName: profile.lastName,
      role: profile.role,
      hasPassword: profile.hasPassword,
      permissions: admin.permissions,
    };
  }

  /**
   * @description Change my password, knowing the current one
   * @route PATCH /api/v1/admin/auth/password
   * @access Admin (own account, whatever the role)
   * @cookie batisso_admin_access
   * @body ChangePasswordDto (currentPassword, newPassword)
   * @returns 204, other sessions of this admin are signed out; 401 INVALID_CREDENTIALS; 403 ACCOUNT_LOCKED (shared login lockout)
   */
  @Patch('password')
  @HttpCode(HttpStatus.NO_CONTENT)
  @OwnAccountRoute()
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
