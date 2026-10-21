import { ApiProperty } from '@nestjs/swagger';
import {
  NotificationType,
  type Notification,
} from '../../generated/prisma/client.js';

const ID_EXAMPLE = '0192f0a4-7b1c-7c3e-9d2a-5e6f7a8b9c0d';

/** One item of the in-app list. */
export class NotificationView {
  @ApiProperty({ example: ID_EXAMPLE })
  id: string;

  @ApiProperty({
    enum: NotificationType,
    example: NotificationType.DEPOSIT_RECORDED,
  })
  type: NotificationType;

  @ApiProperty({ example: 'Dépôt reçu' })
  title: string;

  @ApiProperty({
    example:
      'Dépôt de 5 000 XOF reçu par Quincaillerie du Carrefour sur votre compte C-000123. Nouveau solde : 20 000 XOF. Réf. D-00482.',
  })
  body: string;

  @ApiProperty({
    description:
      'L’opération concernée (son reçu : `GET /me/accounts/:accountId/operations/:operationId`), ou `null`',
    example: ID_EXAMPLE,
    nullable: true,
    type: String,
  })
  operationId: string | null;

  @ApiProperty({ description: '`true` une fois lue', example: false })
  read: boolean;

  @ApiProperty({ example: '2026-10-20T10:00:00.000Z' })
  createdAt: Date;
}

/** A page of the in-app list, with the number of unread items in all pages. */
export class NotificationList {
  @ApiProperty({ type: [NotificationView] })
  items: NotificationView[];

  @ApiProperty({ description: 'Nombre total de notifications', example: 42 })
  total: number;

  @ApiProperty({ example: 1 })
  page: number;

  @ApiProperty({ example: 20 })
  pageSize: number;

  @ApiProperty({
    description: 'Nombre de notifications non lues, toutes pages confondues',
    example: 3,
  })
  unreadCount: number;
}

/** Never the channel, the status, the attempts, or the error of the send. */
export function toNotificationView(row: Notification): NotificationView {
  return {
    id: row.id,
    type: row.type,
    title: row.title,
    body: row.body,
    operationId: row.operationId,
    read: row.readAt !== null,
    createdAt: row.createdAt,
  };
}
