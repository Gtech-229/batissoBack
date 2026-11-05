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
  ApiConflictResponse,
  ApiCreatedResponse,
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
import { JoinStoreDto } from './dto/join-store.dto.js';
import { MyAccount } from './dto/my-account.js';
import { StorePreview } from './dto/store-preview.js';

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

  /**
   * @description Show the store behind a scanned QR code, with its terms, before joining it
   * @route POST /api/v1/me/accounts/join/preview
   * @access Mobile session (Bearer), any signed-in user
   * @body ScanQrCodeDto (code)
   * @returns 200 StorePreview; 404 unknown code; 409 STORE_NOT_VERIFIED
   */
  @Post('join/preview')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Voir une quincaillerie avant de la rejoindre',
    description:
      'La quincaillerie dont vous scannez le QR code, avec ses conditions générales et ses règles de dépôt, à montrer avant que vous acceptiez d’y ouvrir un compte. N’enregistre rien.',
  })
  @ApiOkResponse({ description: 'La quincaillerie', type: StorePreview })
  @ApiBadRequestResponse({
    description: 'Code QR invalide (`details`)',
    type: ErrorResponse,
  })
  @ApiNotFoundResponse({
    description: 'Code inconnu ou remplacé : quincaillerie introuvable',
    type: ErrorResponse,
  })
  @ApiConflictResponse({
    description:
      'Quincaillerie en attente de vérification, suspendue ou fermée (`STORE_NOT_VERIFIED`)',
    type: ErrorResponse,
  })
  previewJoin(@Body() body: ScanQrCodeDto): Promise<StorePreview> {
    return this.accounts.previewStore(body.code);
  }

  /**
   * @description Join the store behind a scanned QR code: the account opens at once, terms accepted in the app
   * @route POST /api/v1/me/accounts/join
   * @access Mobile session (Bearer), any signed-in user
   * @body JoinStoreDto (code, termsAccepted, beneficiary?)
   * @returns 201 MyAccount; 404 unknown code; 409 STORE_NOT_VERIFIED, ACCOUNT_EXISTS or PHONE_NOT_OF_STORE_COUNTRY
   */
  @Post('join')
  @ApiOperation({
    summary: 'Rejoindre une quincaillerie',
    description:
      'Ouvre tout de suite votre compte d’épargne dans la quincaillerie dont vous avez scanné le QR code, après avoir accepté ses conditions dans l’application (voir l’aperçu). La photo de votre pièce d’identité sera prise plus tard au comptoir. Un seul compte par quincaillerie.',
  })
  @ApiCreatedResponse({ description: 'Compte ouvert', type: MyAccount })
  @ApiBadRequestResponse({
    description:
      'Code QR invalide, conditions non acceptées, bénéficiaire invalide (`details`)',
    type: ErrorResponse,
  })
  @ApiNotFoundResponse({
    description: 'Code inconnu ou remplacé : quincaillerie introuvable',
    type: ErrorResponse,
  })
  @ApiConflictResponse({
    description:
      'Quincaillerie non vérifiée (`STORE_NOT_VERIFIED`) ; vous y avez déjà un compte (`ACCOUNT_EXISTS`) ; votre numéro n’est pas du pays de la quincaillerie (`PHONE_NOT_OF_STORE_COUNTRY`)',
    type: ErrorResponse,
  })
  join(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: JoinStoreDto,
  ): Promise<MyAccount> {
    return this.accounts.join(user, body);
  }
}
