import type { Prisma, Subscription } from '../generated/prisma/client.js';
import {
  toSubscriptionView,
  type SubscriptionView,
} from './dto/subscription.dto.js';
import {
  dateToDay,
  dayToDate,
  subscriptionState,
  today,
  type SubscriptionState,
} from './subscription-status.js';

/** What the admin store list and detail show of a store's subscriptions. */
export interface StoreSubscription {
  subscriptionState: SubscriptionState;
  /** The ACTIVE one; periods never overlap, so there is one at most. */
  currentSubscription: SubscriptionView | null;
}

export function toStoreSubscription(
  subscriptions: Subscription[],
  day: string = today(),
): StoreSubscription {
  const state = subscriptionState(
    subscriptions.map((s) => ({
      startsOn: dateToDay(s.startsOn),
      endsOn: dateToDay(s.endsOn),
    })),
    day,
  );
  const current = subscriptions
    .map((s) => toSubscriptionView(s, day))
    .find((s) => s.status === 'ACTIVE');
  return { subscriptionState: state, currentSubscription: current ?? null };
}

/**
 * The stores in a state, as a filter: the same rules as `subscriptionState`,
 * in SQL, so the list pages and counts on them.
 */
export function subscriptionStateWhere(
  state: SubscriptionState,
  day: string = today(),
): Prisma.HardwareStoreWhereInput {
  const date = dayToDate(day);
  const active: Prisma.SubscriptionWhereInput = {
    startsOn: { lte: date },
    endsOn: { gte: date },
  };
  const upcoming: Prisma.SubscriptionWhereInput = { startsOn: { gt: date } };
  switch (state) {
    case 'ACTIVE':
      return { subscriptions: { some: active } };
    case 'UPCOMING':
      return {
        AND: [
          { subscriptions: { none: active } },
          { subscriptions: { some: upcoming } },
        ],
      };
    case 'EXPIRED':
      // Some, and every one ended before today.
      return {
        AND: [
          { subscriptions: { some: {} } },
          { subscriptions: { every: { endsOn: { lt: date } } } },
        ],
      };
    case 'NONE':
      return { subscriptions: { none: {} } };
  }
}
