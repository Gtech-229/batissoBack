import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsIn, IsOptional, IsUUID } from 'class-validator';
import { PaginationQueryDto } from '../../common/pagination.js';
import { TrimLowerCase } from '../../common/validation/trim.js';
import { DisputeStatus } from '../../generated/prisma/client.js';

const STATUS_MESSAGE = `L’état doit être l’un de : ${Object.values(DisputeStatus).join(', ')}`;

/** `GET /me/accounts/:accountId/disputes?status=ANSWERED` */
export class ListMyDisputesQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({
    description: 'Seulement les contestations dans cet état',
    enum: DisputeStatus,
  })
  @IsOptional()
  @IsEnum(DisputeStatus, { message: STATUS_MESSAGE })
  status?: DisputeStatus;
}

/** The disputes an admin oversees (16c): still awaiting the store or the customer. */
export const UNRESOLVED_STATUSES = [
  DisputeStatus.OPEN,
  DisputeStatus.ANSWERED,
] as const;

/** `GET /admin/disputes?status=OPEN&storeId=...` */
export class AdminDisputesQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({
    description:
      'OPEN (en attente de la quincaillerie) ou ANSWERED (en attente du client) ; les deux par défaut',
    enum: UNRESOLVED_STATUSES,
  })
  @IsOptional()
  @IsIn(UNRESOLVED_STATUSES, {
    message: 'L’état doit être OPEN ou ANSWERED',
  })
  status?: DisputeStatus;

  @ApiPropertyOptional({
    description: 'Seulement les contestations de cette quincaillerie',
  })
  @IsOptional()
  @TrimLowerCase()
  @IsUUID('all', { message: 'Identifiant de quincaillerie invalide' })
  storeId?: string;
}

/** `GET /stores/:storeId/disputes?status=OPEN&accountId=...` */
export class ListDisputesQueryDto extends ListMyDisputesQueryDto {
  @ApiPropertyOptional({
    description: 'Seulement les contestations de ce compte',
  })
  @IsOptional()
  @TrimLowerCase()
  @IsUUID('all', { message: 'Identifiant de compte invalide' })
  accountId?: string;
}
