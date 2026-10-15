import { Controller, Get } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { ErrorResponse } from '../common/errors/error-response.js';
import type { AuthenticatedUser } from '../mobile-auth/authenticated-user.js';
import { CurrentUser } from '../mobile-auth/decorators/current-user.decorator.js';
import { MobileRoute } from '../mobile-auth/decorators/mobile-route.decorator.js';
import { AccountsService } from './accounts.service.js';
import { MyAccount } from './dto/my-account.js';

@ApiTags('Mobile - Mon compte')
@ApiBearerAuth()
@ApiUnauthorizedResponse({
  description: 'Session absente, expirée ou fermée',
  type: ErrorResponse,
})
@MobileRoute()
@Controller('me/accounts')
export class MyAccountsController {
  constructor(private readonly accounts: AccountsService) {}

  /**
   * @description List the signed-in user's own savings accounts, in every store
   * @route GET /api/v1/me/accounts
   * @access Mobile session (Bearer)
   * @returns 200 MyAccount[] (empty when the user has no account)
   */
  @Get()
  @ApiOperation({
    summary: 'Mes comptes d’épargne',
    description:
      'Les comptes de l’utilisateur connecté dans toutes les quincailleries, du plus récent au plus ancien, avec leur solde et leurs objectifs. Liste vide s’il n’a aucun compte.',
  })
  @ApiOkResponse({ description: 'Mes comptes', type: [MyAccount] })
  mine(@CurrentUser() user: AuthenticatedUser): Promise<MyAccount[]> {
    return this.accounts.mine(user.userId);
  }
}
