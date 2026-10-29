import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional, IsUUID } from 'class-validator';
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
