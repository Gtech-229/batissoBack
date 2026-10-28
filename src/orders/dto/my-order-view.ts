import { ApiProperty } from '@nestjs/swagger';
import type { HardwareStore, Prisma } from '../../generated/prisma/client.js';
import {
  ORDER_LINES_ORDER,
  OrderFields,
  toOrderFields,
  type OrderWithFields,
} from './order-view.js';

export class MyOrderStore {
  @ApiProperty({
    description: 'Identifiant de la quincaillerie',
    example: '0192f0a4-7b1c-7c3e-9d2a-5e6f7a8b9c0d',
  })
  id: string;

  @ApiProperty({
    description: 'Nom de la quincaillerie',
    example: 'Quincaillerie du Carrefour',
  })
  name: string;
}

/** The customer's view of an order: no staff identity, the store instead. */
export class MyOrderView extends OrderFields {
  @ApiProperty({ description: 'Quincaillerie du bon', type: MyOrderStore })
  store: MyOrderStore;
}

/** What `toMyOrderView` needs: never the staff who did each step. */
export const MY_ORDER_INCLUDE = {
  account: { select: { number: true, currencyCode: true } },
  goal: { select: { id: true, label: true } },
  lines: ORDER_LINES_ORDER,
  operation: { select: { reference: true } },
  recreditOperation: { select: { reference: true } },
  store: { select: { id: true, name: true } },
} satisfies Prisma.MaterialOrderInclude;

export function toMyOrderView(
  order: OrderWithFields & { store: Pick<HardwareStore, 'id' | 'name'> },
): MyOrderView {
  return {
    ...toOrderFields(order),
    store: { id: order.store.id, name: order.store.name },
  };
}
