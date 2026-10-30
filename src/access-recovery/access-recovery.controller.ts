import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiBody,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { invalidAccountId } from '../accounts/accounts.errors.js';
import { invalidUserId } from '../staff/staff.errors.js';
import { ErrorResponse } from '../common/errors/error-response.js';
import type { AuthenticatedUser } from '../mobile-auth/authenticated-user.js';
import { CurrentUser } from '../mobile-auth/decorators/current-user.decorator.js';
import { MobileRoute } from '../mobile-auth/decorators/mobile-route.decorator.js';
import type { CurrentStoreContext } from '../store-access/current-store.js';
import { CurrentStore } from '../store-access/decorators/current-store.decorator.js';
import { StoreRoles } from '../store-access/decorators/store-roles.decorator.js';
import { AccessRecoveryService } from './access-recovery.service.js';
import { AccessResetView } from './dto/access-reset-view.js';
import { ResetAccessDto } from './dto/reset-access.dto.js';

const AccountIdPipe = new ParseUUIDPipe({ exceptionFactory: invalidAccountId });
const UserIdPipe = new ParseUUIDPipe({ exceptionFactory: invalidUserId });

const RESET_DESCRIPTION =
  'Après une perte de téléphone ou un code PIN oublié, et une fois l’identité de la personne vérifiée au comptoir. Le code PIN est effacé, toutes les sessions sont fermées et aucun appareil n’est plus reconnu, dans toutes les quincailleries. La personne se reconnecte avec un code SMS et choisit un nouveau code PIN. Elle est prévenue par SMS. Possible quel que soit le statut de la quincaillerie ; aucun argent n’est déplacé.';

@ApiTags('Mobile - Récupération d’accès')
@ApiBearerAuth()
@ApiParam({ name: 'storeId', description: 'Identifiant de la quincaillerie' })
@ApiUnauthorizedResponse({
  description: 'Session absente, expirée ou fermée',
  type: ErrorResponse,
})
@ApiForbiddenResponse({
  description:
    'Membre qui n’est pas le gérant (`STORE_ROLE_REQUIRED`) ; la personne est gérante d’une quincaillerie (`MANAGER_RESET_NOT_ALLOWED`)',
  type: ErrorResponse,
})
@MobileRoute()
@StoreRoles(['MANAGER'])
@Controller('stores/:storeId')
export class AccessRecoveryController {
  constructor(private readonly recovery: AccessRecoveryService) {}

  /**
   * @description Reset the access of an account's holder after a lost phone or a forgotten PIN
   * @route POST /api/v1/stores/:storeId/accounts/:accountId/access-reset
   * @access Store manager (mobile session)
   * @param storeId the store
   * @param accountId the account
   * @body ResetAccessDto (clearSecurityQuestions?)
   * @returns 200 AccessResetView; 403 MANAGER_RESET_NOT_ALLOWED
   */
  @Post('accounts/:accountId/access-reset')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Réinitialiser l’accès d’un client',
    description: RESET_DESCRIPTION,
  })
  @ApiParam({ name: 'accountId', description: 'Identifiant du compte' })
  @ApiBody({ type: ResetAccessDto, required: false })
  @ApiOkResponse({ description: 'Accès réinitialisé', type: AccessResetView })
  @ApiBadRequestResponse({
    description: 'Identifiant de quincaillerie ou de compte invalide',
    type: ErrorResponse,
  })
  @ApiNotFoundResponse({
    description:
      'Quincaillerie introuvable : vous n’en êtes pas membre actif ; ou compte introuvable dans cette quincaillerie',
    type: ErrorResponse,
  })
  resetAccountHolder(
    @CurrentStore() store: CurrentStoreContext,
    @CurrentUser() actor: AuthenticatedUser,
    @Param('accountId', AccountIdPipe) accountId: string,
    @Body() body: ResetAccessDto,
  ): Promise<AccessResetView> {
    return this.recovery.resetAccountHolder(
      store,
      actor,
      accountId,
      body.clearSecurityQuestions === true,
    );
  }

  /**
   * @description Reset the access of a seller of the store after a lost phone or a forgotten PIN
   * @route POST /api/v1/stores/:storeId/sellers/:userId/access-reset
   * @access Store manager (mobile session)
   * @param storeId the store
   * @param userId the seller, active or not
   * @body ResetAccessDto (clearSecurityQuestions?)
   * @returns 200 AccessResetView; 403 MANAGER_RESET_NOT_ALLOWED
   */
  @Post('sellers/:userId/access-reset')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Réinitialiser l’accès d’un vendeur',
    description: RESET_DESCRIPTION,
  })
  @ApiParam({ name: 'userId', description: 'Identifiant du vendeur' })
  @ApiBody({ type: ResetAccessDto, required: false })
  @ApiOkResponse({ description: 'Accès réinitialisé', type: AccessResetView })
  @ApiBadRequestResponse({
    description: 'Identifiant de quincaillerie ou d’utilisateur invalide',
    type: ErrorResponse,
  })
  @ApiNotFoundResponse({
    description:
      'Quincaillerie introuvable : vous n’en êtes pas membre actif ; ou vendeur introuvable dans cette quincaillerie',
    type: ErrorResponse,
  })
  resetSeller(
    @CurrentStore() store: CurrentStoreContext,
    @CurrentUser() actor: AuthenticatedUser,
    @Param('userId', UserIdPipe) userId: string,
    @Body() body: ResetAccessDto,
  ): Promise<AccessResetView> {
    return this.recovery.resetSeller(
      store,
      actor,
      userId,
      body.clearSecurityQuestions === true,
    );
  }
}
