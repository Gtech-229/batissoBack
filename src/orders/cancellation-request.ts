import type { HttpException } from '@nestjs/common';
import { MaterialOrderStatus } from '../generated/prisma/client.js';
import {
  cancellationAlreadyRequested,
  deliveryDelayNotReached,
  orderStatusConflict,
} from './orders.errors.js';

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * From when the customer may ask to cancel a confirmed, undelivered order
 * (11c): the store's delivery delay after their confirmation. The request is
 * allowed when `now >= opensAt`.
 */
export function cancellationRequestOpensAt(
  confirmedAt: Date,
  deliveryDelayDays: number,
): Date {
  return new Date(confirmedAt.getTime() + deliveryDelayDays * DAY_MS);
}

/** A date for a French message: jj/mm/aaaa, in UTC (recorded choice, 11c). */
export function frenchDate(date: Date): string {
  const two = (value: number) => String(value).padStart(2, '0');
  return `${two(date.getUTCDate())}/${two(date.getUTCMonth() + 1)}/${date.getUTCFullYear()}`;
}

/** What the request rule needs to know of an order. */
export interface RequestableOrder {
  status: MaterialOrderStatus;
  confirmedAt: Date | null;
  cancellationRequestedAt: Date | null;
  store: { settings: { deliveryDelayDays: number } | null };
}

/**
 * Why the customer may not ask to cancel this order now, or null when they
 * may (11c), checked in this order: not CONFIRMED (409 ORDER_STATUS), already
 * asked (409 CANCELLATION_ALREADY_REQUESTED), or the store's delay not passed
 * (409 DELIVERY_DELAY_NOT_REACHED, giving the date it opens).
 */
export function cancellationRequestRefusal(
  order: RequestableOrder,
  now: Date,
): HttpException | null {
  if (order.status !== MaterialOrderStatus.CONFIRMED) {
    return orderStatusConflict(order.status);
  }
  if (order.cancellationRequestedAt !== null) {
    return cancellationAlreadyRequested();
  }
  // A CONFIRMED order always has both (10b, and every store has settings).
  const opensAt = cancellationRequestOpensAt(
    order.confirmedAt!,
    order.store.settings!.deliveryDelayDays,
  );
  if (now < opensAt) {
    return deliveryDelayNotReached(frenchDate(opensAt));
  }
  return null;
}
