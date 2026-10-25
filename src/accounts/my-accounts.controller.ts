import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { ErrorResponse } from '../common/errors/error-response.js';
import type { AuthenticatedUser } from '../mobile-auth/authenticated-user.js';
import { CurrentUser } from '../mobile-auth/decorators/current-user.decorator.js';
import { MobileRoute } from '../mobile-auth/decorators/mobile-route.decorator.js';
import { ScanQrCodeDto } from '../qr-codes/dto/qr-code.dto.js';
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

  /**
   * @description Reach the signed-in user's account in a store by scanning the store's QR code
   * @route POST /api/v1/me/accounts/scan
   * @access Mobile session (Bearer), the account's customer only
   * @body ScanQrCodeDto (code)
   * @returns 200 MyAccount; 404 Compte introuvable (unknown code, or no account in that store)
   */
  @Post('scan')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Scanner le QR code d’une quincaillerie',
    description:
      'Retrouve votre compte dans la quincaillerie dont vous scannez le QR code. Un code inconnu ou remplacé et l’absence de compte dans cette quincaillerie répondent le même 404 « Compte introuvable ».',
  })
  @ApiOkResponse({ description: 'Mon compte', type: MyAccount })
  @ApiBadRequestResponse({
    description: 'Code QR invalide (`details`)',
    type: ErrorResponse,
  })
  @ApiNotFoundResponse({
    description: 'Compte introuvable',
    type: ErrorResponse,
  })
  scan(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: ScanQrCodeDto,
  ): Promise<MyAccount> {
    return this.accounts.scanMine(user.userId, body.code);
  }
}
