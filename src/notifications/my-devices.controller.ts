import { Body, Controller, HttpCode, HttpStatus, Put } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiNoContentResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { ErrorResponse } from '../common/errors/error-response.js';
import type { AuthenticatedUser } from '../mobile-auth/authenticated-user.js';
import { CurrentUser } from '../mobile-auth/decorators/current-user.decorator.js';
import { MobileRoute } from '../mobile-auth/decorators/mobile-route.decorator.js';
import { PushTokenDto } from './dto/push-token.dto.js';
import { NotificationsService } from './notifications.service.js';

@ApiTags('Mobile - Mon compte')
@ApiBearerAuth()
@ApiUnauthorizedResponse({
  description: 'Session absente, expirée ou fermée',
  type: ErrorResponse,
})
@MobileRoute()
@Controller('me/devices')
export class MyDevicesController {
  constructor(private readonly notifications: NotificationsService) {}

  /**
   * @description Register (or remove) the push token of the session's device
   * @route PUT /api/v1/me/devices/push-token
   * @access Mobile session (Bearer)
   * @body PushTokenDto (token, or null to turn push off)
   * @returns 204
   */
  @Put('push-token')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Enregistrer le jeton de notification push',
    description:
      'Associe le jeton push (FCM) de l’application à l’appareil de cette session. Un jeton déjà associé à un autre appareil lui est retiré (téléphone qui change de mains). `null` désactive les notifications push sur ce téléphone.',
  })
  @ApiNoContentResponse({ description: 'Jeton enregistré ou retiré' })
  @ApiBadRequestResponse({
    description: 'Jeton absent ou invalide (`details`)',
    type: ErrorResponse,
  })
  setPushToken(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: PushTokenDto,
  ): Promise<void> {
    return this.notifications.setPushToken(user, body.token);
  }
}
