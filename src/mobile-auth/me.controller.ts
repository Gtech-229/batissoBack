import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Put,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiForbiddenResponse,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { ErrorResponse } from '../common/errors/error-response.js';
import type { AuthenticatedUser } from './authenticated-user.js';
import { CurrentUser } from './decorators/current-user.decorator.js';
import { MobileRoute } from './decorators/mobile-route.decorator.js';
import { ChangePinDto } from './dto/change-pin.dto.js';
import { MeResponse } from './dto/me.js';
import { MobileAuthService } from './mobile-auth.service.js';

@ApiTags('Mobile - Mon compte')
@ApiBearerAuth()
@ApiUnauthorizedResponse({
  description: 'Session absente, expirée ou fermée',
  type: ErrorResponse,
})
@MobileRoute()
@Controller('me')
export class MeController {
  constructor(private readonly auth: MobileAuthService) {}

  /**
   * @description Get the signed-in user and the stores they work in
   * @route GET /api/v1/me
   * @access Mobile session (Bearer)
   * @returns 200 MeResponse
   */
  @Get()
  @ApiOperation({
    summary: 'Mon profil',
    description:
      'L’utilisateur connecté et les quincailleries où il travaille, avec son rôle dans chacune.',
  })
  @ApiOkResponse({ description: 'Profil', type: MeResponse })
  me(@CurrentUser() user: AuthenticatedUser): Promise<MeResponse> {
    return this.auth.profile(user.userId);
  }

  /**
   * @description Change the signed-in user's PIN; their sessions on other devices end
   * @route PUT /api/v1/me/pin
   * @access Mobile session (Bearer)
   * @body ChangePinDto (currentPin, newPin)
   * @returns 204 no content; 400 INVALID_PIN or PIN_UNCHANGED; 403 PIN_LOCKED
   */
  @Put('pin')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Changer mon code PIN',
    description:
      'Vérifie le code PIN actuel, avec le même blocage qu’à la connexion, puis enregistre le nouveau. Les sessions sur les autres appareils sont fermées ; celle-ci reste ouverte. Ces appareils restent reconnus : ils se reconnectent avec le nouveau code PIN.',
  })
  @ApiNoContentResponse({ description: 'Code PIN changé' })
  @ApiBadRequestResponse({
    description:
      'Code PIN actuel incorrect (`INVALID_PIN`) ; nouveau code PIN identique à l’actuel (`PIN_UNCHANGED`) ; code PIN invalide ou trop simple (`details`)',
    type: ErrorResponse,
  })
  @ApiForbiddenResponse({
    description: 'Trop d’essais incorrects (`PIN_LOCKED`)',
    type: ErrorResponse,
  })
  changePin(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: ChangePinDto,
  ): Promise<void> {
    return this.auth.changePin(user, body.currentPin, body.newPin);
  }
}
