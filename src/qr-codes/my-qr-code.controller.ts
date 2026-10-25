import { Controller, Get, HttpCode, HttpStatus, Post } from '@nestjs/common';
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
import { QrCodeView } from './dto/qr-code.dto.js';
import { QrCodesService } from './qr-codes.service.js';

@ApiTags('Mobile - Mon QR code')
@ApiBearerAuth()
@ApiUnauthorizedResponse({
  description: 'Session absente, expirée ou fermée',
  type: ErrorResponse,
})
@MobileRoute()
@Controller('me/qr-code')
export class MyQrCodeController {
  constructor(private readonly qrCodes: QrCodesService) {}

  /**
   * @description Get the signed-in user's QR code (created on first read), for a store to scan
   * @route GET /api/v1/me/qr-code
   * @access Mobile session (Bearer)
   * @returns 200 QrCodeView
   */
  @Get()
  @ApiOperation({
    summary: 'Mon QR code',
    description:
      'Le code à afficher en QR code : une quincaillerie qui le scanne retrouve votre compte chez elle. Il ne contient aucune donnée personnelle et reste valable jusqu’à ce que vous le régénériez.',
  })
  @ApiOkResponse({ description: 'Mon QR code', type: QrCodeView })
  myCode(@CurrentUser() user: AuthenticatedUser): Promise<QrCodeView> {
    return this.qrCodes.myCode(user.userId);
  }

  /**
   * @description Replace the signed-in user's QR code (the old one stops working at once)
   * @route POST /api/v1/me/qr-code/regenerate
   * @access Mobile session (Bearer)
   * @returns 200 QrCodeView
   */
  @Post('regenerate')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Régénérer mon QR code',
    description:
      'Remplace votre QR code, par exemple si une photo en circule : l’ancien ne permet plus de retrouver votre compte.',
  })
  @ApiOkResponse({ description: 'Nouveau QR code', type: QrCodeView })
  regenerate(@CurrentUser() user: AuthenticatedUser): Promise<QrCodeView> {
    return this.qrCodes.regenerateMine(user.userId);
  }
}
