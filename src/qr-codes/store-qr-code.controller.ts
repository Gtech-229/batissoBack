import { Controller, Get, HttpCode, HttpStatus, Post } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiConflictResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { ErrorResponse } from '../common/errors/error-response.js';
import type { AuthenticatedUser } from '../mobile-auth/authenticated-user.js';
import { CurrentUser } from '../mobile-auth/decorators/current-user.decorator.js';
import { MobileRoute } from '../mobile-auth/decorators/mobile-route.decorator.js';
import type { CurrentStoreContext } from '../store-access/current-store.js';
import { CurrentStore } from '../store-access/decorators/current-store.decorator.js';
import { StoreRoles } from '../store-access/decorators/store-roles.decorator.js';
import { QrCodeView } from './dto/qr-code.dto.js';
import { QrCodesService } from './qr-codes.service.js';

@ApiTags('Mobile - QR code de la quincaillerie')
@ApiBearerAuth()
@ApiParam({ name: 'storeId', description: 'Identifiant de la quincaillerie' })
@ApiUnauthorizedResponse({
  description: 'Session absente, expirée ou fermée',
  type: ErrorResponse,
})
@ApiNotFoundResponse({
  description: 'Quincaillerie introuvable : vous n’en êtes pas membre actif',
  type: ErrorResponse,
})
// Every route answers 400 to a malformed store id (StoreAccessGuard).
@ApiBadRequestResponse({
  description: 'Identifiant de quincaillerie invalide',
  type: ErrorResponse,
})
@MobileRoute()
@Controller('stores/:storeId/qr-code')
export class StoreQrCodeController {
  constructor(private readonly qrCodes: QrCodesService) {}

  /**
   * @description Get the store's QR code (created on first read), for its customers to scan
   * @route GET /api/v1/stores/:storeId/qr-code
   * @access Store manager or seller (mobile session)
   * @param storeId the store
   * @returns 200 QrCodeView
   */
  @Get()
  @StoreRoles(['MANAGER', 'SELLER'])
  @ApiOperation({
    summary: 'QR code de la quincaillerie',
    description:
      'Le code à afficher (ou imprimer) en QR code au comptoir : un client qui le scanne retrouve son compte dans cette quincaillerie. Il ne contient aucune donnée et reste valable jusqu’à ce qu’un gérant le régénère.',
  })
  @ApiOkResponse({
    description: 'QR code de la quincaillerie',
    type: QrCodeView,
  })
  storeCode(@CurrentStore() store: CurrentStoreContext): Promise<QrCodeView> {
    return this.qrCodes.storeCode(store.storeId);
  }

  /**
   * @description Replace the store's QR code (the old one stops working at once)
   * @route POST /api/v1/stores/:storeId/qr-code/regenerate
   * @access Store manager (mobile session)
   * @param storeId the store
   * @returns 200 QrCodeView; 409 STORE_CLOSED
   */
  @Post('regenerate')
  @HttpCode(HttpStatus.OK)
  @StoreRoles(['MANAGER'])
  @ApiOperation({
    summary: 'Régénérer le QR code de la quincaillerie',
    description:
      'Remplace le QR code (par exemple après une affiche abîmée ou copiée) : l’ancien ne permet plus de retrouver un compte. Impossible dans une quincaillerie fermée.',
  })
  @ApiOkResponse({ description: 'Nouveau QR code', type: QrCodeView })
  @ApiForbiddenResponse({
    description: 'Membre sans le rôle de gérant (`STORE_ROLE_REQUIRED`)',
    type: ErrorResponse,
  })
  @ApiConflictResponse({
    description: 'Quincaillerie fermée (`STORE_CLOSED`)',
    type: ErrorResponse,
  })
  regenerate(
    @CurrentStore() store: CurrentStoreContext,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<QrCodeView> {
    return this.qrCodes.regenerateStore(store.storeId, actor);
  }
}
