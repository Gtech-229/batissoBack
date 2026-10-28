import type { HttpException } from '@nestjs/common';
import type { Prisma } from '../generated/prisma/client.js';
import {
  notOrderPreparer,
  orderNotFound,
  orderStatusConflict,
} from './orders.errors.js';

/**
 * Why a conditional write on an order of this store changed nothing: no such
 * order (404), not its preparer (403, only with `preparerId`), or its status
 * (409). Shared by every order step that writes conditionally.
 */
export async function unchangedReason(
  tx: Prisma.TransactionClient,
  storeId: string,
  orderId: string,
  preparerId?: string,
): Promise<HttpException> {
  const order = await tx.materialOrder.findFirst({
    where: { id: orderId, storeId },
    select: { status: true, createdById: true },
  });
  if (!order) {
    return orderNotFound();
  }
  if (preparerId !== undefined && order.createdById !== preparerId) {
    return notOrderPreparer();
  }
  return orderStatusConflict(order.status);
}
