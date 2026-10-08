import { Controller, Get } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { ErrorResponse } from '../common/errors/error-response.js';
import type { AuthenticatedUser } from './authenticated-user.js';
import { CurrentUser } from './decorators/current-user.decorator.js';
import { MobileRoute } from './decorators/mobile-route.decorator.js';
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
}
