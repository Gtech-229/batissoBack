import { BadRequestException, NotFoundException } from '@nestjs/common';

/** Not one of the user's notifications: someone else's answers the same. */
export function notificationNotFound(): NotFoundException {
  return new NotFoundException('Notification introuvable');
}

export function invalidNotificationId(): BadRequestException {
  return new BadRequestException('Identifiant de notification invalide');
}
