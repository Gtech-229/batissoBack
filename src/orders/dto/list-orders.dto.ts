import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional, IsUUID } from 'class-validator';
import { PaginationQueryDto } from '../../common/pagination.js';
import { TrimLowerCase } from '../../common/validation/trim.js';
import { MaterialOrderStatus } from '../../generated/prisma/client.js';

const STATUS_MESSAGE = `L’état doit être l’un de : ${Object.values(MaterialOrderStatus).join(', ')}`;

/** `GET /me/accounts/:accountId/orders?status=AWAITING_CUSTOMER` */
export class ListMyOrdersQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({
    description: 'Seulement les bons dans cet état',
    enum: MaterialOrderStatus,
  })
  @IsOptional()
  @IsEnum(MaterialOrderStatus, { message: STATUS_MESSAGE })
  status?: MaterialOrderStatus;
}

/** `GET /stores/:storeId/orders?status=AWAITING_VALIDATION&accountId=...` */
export class ListOrdersQueryDto extends ListMyOrdersQueryDto {
  @ApiPropertyOptional({ description: 'Seulement les bons de ce compte' })
  @IsOptional()
  @TrimLowerCase()
  @IsUUID('all', { message: 'Identifiant de compte invalide' })
  accountId?: string;
}
