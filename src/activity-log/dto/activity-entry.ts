import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ActivityAction,
  type ActivityLog,
  type User,
} from '../../generated/prisma/client.js';

export class ActivityAuthor {
  @ApiProperty({
    description: 'Identifiant de l’auteur',
    example: '0192f0a4-7b1c-7c3e-9d2a-5e6f7a8b9c0d',
  })
  userId: string;

  @ApiProperty({ description: 'Prénom', example: 'Awa' })
  firstName: string;

  @ApiProperty({ description: 'Nom', example: 'Diallo' })
  lastName: string;
}

export class ActivityEntry {
  @ApiProperty({
    description: 'Identifiant de l’entrée',
    example: '0192f0a4-7b1c-7c3e-9d2a-5e6f7a8b9c0d',
  })
  id: string;

  @ApiProperty({
    description: 'Action enregistrée',
    enum: ActivityAction,
    example: ActivityAction.SELLER_ADDED,
  })
  action: ActivityAction;

  @ApiProperty({ type: ActivityAuthor })
  author: ActivityAuthor;

  @ApiPropertyOptional({
    description: 'Valeur avant l’action (selon l’action), ou null',
    example: { userId: '0192f0a4-...', active: true },
    nullable: true,
  })
  oldValue: unknown;

  @ApiPropertyOptional({
    description: 'Valeur après l’action (selon l’action), ou null',
    example: { userId: '0192f0a4-...', active: false },
    nullable: true,
  })
  newValue: unknown;

  @ApiPropertyOptional({
    description: 'Identifiant de l’appareil de l’auteur, ou null',
    example: 'device-0001-abcd',
    nullable: true,
  })
  device: string | null;

  @ApiProperty({
    description: 'Date de l’action (heure du serveur)',
    example: '2026-10-14T09:00:00.000Z',
  })
  createdAt: Date;
}

export function toActivityEntry(
  log: ActivityLog & { user: Pick<User, 'id' | 'firstName' | 'lastName'> },
): ActivityEntry {
  return {
    id: log.id,
    action: log.action,
    // Names only: never the author's phone, PIN hash, or lockout state.
    author: {
      userId: log.user.id,
      firstName: log.user.firstName,
      lastName: log.user.lastName,
    },
    oldValue: log.oldValue,
    newValue: log.newValue,
    device: log.device,
    createdAt: log.createdAt,
  };
}
