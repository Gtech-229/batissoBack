import {
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Query,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { ErrorResponse } from '../common/errors/error-response.js';
import { PaginationQueryDto } from '../common/pagination.js';
import type { AuthenticatedUser } from '../mobile-auth/authenticated-user.js';
import { CurrentUser } from '../mobile-auth/decorators/current-user.decorator.js';
import { MobileRoute } from '../mobile-auth/decorators/mobile-route.decorator.js';
import { NotificationList, NotificationView } from './dto/notification-view.js';
import { invalidNotificationId } from './notifications.errors.js';
import { NotificationsService } from './notifications.service.js';

const NotificationIdPipe = new ParseUUIDPipe({
  exceptionFactory: invalidNotificationId,
});

@ApiTags('Mobile - Mon compte')
@ApiBearerAuth()
@ApiUnauthorizedResponse({
  description: 'Session absente, expirée ou fermée',
  type: ErrorResponse,
})
@MobileRoute()
@Controller('me/notifications')
export class MyNotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  /**
   * @description List the signed-in user's in-app notifications, newest first, with the unread count
   * @route GET /api/v1/me/notifications
   * @access Mobile session (Bearer)
   * @query PaginationQueryDto (page, pageSize)
   * @returns 200 NotificationList
   */
  @Get()
  @ApiOperation({
    summary: 'Mes notifications',
    description:
      'Les notifications de l’application, de la plus récente à la plus ancienne, et le nombre de notifications non lues.',
  })
  @ApiOkResponse({
    description: 'Page de notifications',
    type: NotificationList,
  })
  @ApiBadRequestResponse({
    description: 'Pagination invalide (`details`)',
    type: ErrorResponse,
  })
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: PaginationQueryDto,
  ): Promise<NotificationList> {
    return this.notifications.list(user.userId, query);
  }

  /**
   * @description Mark one of the user's notifications as read (idempotent)
   * @route PATCH /api/v1/me/notifications/:notificationId/read
   * @access Mobile session (Bearer)
   * @param notificationId the notification
   * @returns 200 NotificationView; 404 not the user's notification
   */
  @Patch(':notificationId/read')
  @ApiOperation({
    summary: 'Marquer une notification comme lue',
    description:
      'Sans effet si elle est déjà lue. La notification d’un autre utilisateur répond 404.',
  })
  @ApiParam({
    name: 'notificationId',
    description: 'Identifiant de la notification',
  })
  @ApiOkResponse({ description: 'Notification lue', type: NotificationView })
  @ApiBadRequestResponse({
    description: 'Identifiant de notification invalide',
    type: ErrorResponse,
  })
  @ApiNotFoundResponse({
    description: 'Notification introuvable parmi les vôtres',
    type: ErrorResponse,
  })
  markRead(
    @CurrentUser() user: AuthenticatedUser,
    @Param('notificationId', NotificationIdPipe) notificationId: string,
  ): Promise<NotificationView> {
    return this.notifications.markRead(user.userId, notificationId);
  }
}
