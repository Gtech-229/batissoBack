import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional, IsUUID } from 'class-validator';
import { PaginationQueryDto } from '../../common/pagination.js';
import { IsDay } from '../../common/validation/day.js';
import { TrimLowerCase } from '../../common/validation/trim.js';
import {
  ActivityAction,
  type ActivityLog,
  type HardwareStore,
  type User,
} from '../../generated/prisma/client.js';
import { ActivityEntry, toActivityEntry } from './activity-entry.js';

/** `GET /admin/activity?storeId=...&action=SELLER_ADDED&from=2026-11-01&to=2026-11-30` */
export class AdminActivityQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({
    description: 'Seulement le journal de cette quincaillerie',
  })
  @IsOptional()
  @TrimLowerCase()
  @IsUUID('all', { message: 'Identifiant de quincaillerie invalide' })
  storeId?: string;

  @ApiPropertyOptional({
    description: 'Seulement cette action',
    enum: ActivityAction,
  })
  @IsOptional()
  @IsEnum(ActivityAction, {
    message: `L’action doit être l’une de : ${Object.values(ActivityAction).join(', ')}`,
  })
  action?: ActivityAction;

  @ApiPropertyOptional({
    description: 'Premier jour, inclus (AAAA-MM-JJ, UTC)',
    example: '2026-11-01',
  })
  @IsOptional()
  @IsDay()
  from?: string;

  @ApiPropertyOptional({
    description: 'Dernier jour, inclus (AAAA-MM-JJ, UTC)',
    example: '2026-11-30',
  })
  @IsOptional()
  @IsDay()
  to?: string;
}

export class AdminActivityStore {
  @ApiProperty({ example: '0192f0a4-7b1c-7c3e-9d2a-5e6f7a8b9c0d' })
  id: string;

  @ApiProperty({ example: 'Quincaillerie du Carrefour' })
  name: string;
}

/** A store's activity entry, as the manager sees it, with the store named. */
export class AdminActivityEntry extends ActivityEntry {
  @ApiProperty({
    description: 'La quincaillerie de l’action, ou null',
    type: AdminActivityStore,
    nullable: true,
  })
  store: AdminActivityStore | null;
}

export function toAdminActivityEntry(
  log: ActivityLog & {
    user: Pick<User, 'id' | 'firstName' | 'lastName'>;
    store: Pick<HardwareStore, 'id' | 'name'> | null;
  },
): AdminActivityEntry {
  const { id, action, author, oldValue, newValue, device, createdAt } =
    toActivityEntry(log);
  return {
    id,
    action,
    author,
    oldValue,
    newValue,
    device,
    createdAt,
    store: log.store ? { id: log.store.id, name: log.store.name } : null,
  };
}
