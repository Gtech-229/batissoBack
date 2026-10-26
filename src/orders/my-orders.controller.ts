import { Controller, Get, Param, ParseUUIDPipe, Query } from '@nestjs/common';
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
import { invalidAccountId } from '../accounts/accounts.errors.js';
import { ErrorResponse } from '../common/errors/error-response.js';
import { ApiPaginatedResponse, type Paginated } from '../common/pagination.js';
import type { AuthenticatedUser } from '../mobile-auth/authenticated-user.js';
import { CurrentUser } from '../mobile-auth/decorators/current-user.decorator.js';
import { MobileRoute } from '../mobile-auth/decorators/mobile-route.decorator.js';
import { ListMyOrdersQueryDto } from './dto/list-orders.dto.js';
import { MyOrderView } from './dto/my-order-view.js';
import { invalidOrderId } from './orders.errors.js';
import { OrdersService } from './orders.service.js';

const AccountIdPipe = new ParseUUIDPipe({ exceptionFactory: invalidAccountId });
const OrderIdPipe = new ParseUUIDPipe({ exceptionFactory: invalidOrderId });

@ApiTags('Mobile - Mes bons de sortie')
@ApiBearerAuth()
@ApiParam({ name: 'accountId', description: 'Identifiant de mon compte' })
@ApiUnauthorizedResponse({
  description: 'Session absente, expirée ou fermée',
  type: ErrorResponse,
})
@ApiNotFoundResponse({
  description:
    'Compte introuvable parmi les vôtres, ou bon introuvable sur ce compte',
  type: ErrorResponse,
})
@MobileRoute()
@Controller('me/accounts/:accountId/orders')
export class MyOrdersController {
  constructor(private readonly orders: OrdersService) {}

  /**
   * @description List the material orders of one of the user's accounts, newest first
   * @route GET /api/v1/me/accounts/:accountId/orders
   * @access Mobile session (Bearer), the account's customer only
   * @param accountId one of the user's accounts
   * @query ListMyOrdersQueryDto (page, pageSize, status?)
   * @returns 200 Paginated<MyOrderView>
   */
  @Get()
  @ApiOperation({
    summary: 'Mes bons de sortie',
    description:
      'Les bons préparés sur ce compte, du plus récent au plus ancien, paginés, avec leurs lignes et leur état.',
  })
  @ApiPaginatedResponse(MyOrderView, 'Mes bons de sortie')
  @ApiBadRequestResponse({
    description:
      'Identifiant de compte invalide ; filtre ou pagination invalide (`details`)',
    type: ErrorResponse,
  })
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Param('accountId', AccountIdPipe) accountId: string,
    @Query() query: ListMyOrdersQueryDto,
  ): Promise<Paginated<MyOrderView>> {
    return this.orders.listMine(user.userId, accountId, query);
  }

  /**
   * @description One material order of one of the user's accounts
   * @route GET /api/v1/me/accounts/:accountId/orders/:orderId
   * @access Mobile session (Bearer), the account's customer only
   * @param accountId one of the user's accounts
   * @param orderId the order
   * @returns 200 MyOrderView
   */
  @Get(':orderId')
  @ApiOperation({ summary: 'Détail d’un de mes bons de sortie' })
  @ApiParam({ name: 'orderId', description: 'Identifiant du bon' })
  @ApiOkResponse({ description: 'Bon', type: MyOrderView })
  @ApiBadRequestResponse({
    description: 'Identifiant de compte ou de bon invalide',
    type: ErrorResponse,
  })
  detail(
    @CurrentUser() user: AuthenticatedUser,
    @Param('accountId', AccountIdPipe) accountId: string,
    @Param('orderId', OrderIdPipe) orderId: string,
  ): Promise<MyOrderView> {
    return this.orders.detailMine(user.userId, accountId, orderId);
  }
}
