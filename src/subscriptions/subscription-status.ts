/** Where a subscription stands today; computed, never stored. */
export const SUBSCRIPTION_STATUSES = ['UPCOMING', 'ACTIVE', 'EXPIRED'] as const;
export type SubscriptionStatus = (typeof SUBSCRIPTION_STATUSES)[number];

/** Where a store stands: its subscriptions seen together, or none ever. */
export const SUBSCRIPTION_STATES = [
  'ACTIVE',
  'UPCOMING',
  'EXPIRED',
  'NONE',
] as const;
export type SubscriptionState = (typeof SUBSCRIPTION_STATES)[number];

/** A `YYYY-MM-DD` day as stored in a `@db.Date` column: midnight UTC. */
export function dayToDate(day: string): Date {
  return new Date(`${day}T00:00:00.000Z`);
}

/** The `YYYY-MM-DD` day of a `@db.Date` value. */
export function dateToDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** Today's UTC day: the one clock of subscriptions. */
export function today(now: Date = new Date()): string {
  return dateToDay(now);
}

/** `startsOn` and `endsOn` are both included: ACTIVE on either day. */
export function subscriptionStatus(
  period: { startsOn: string; endsOn: string },
  day: string,
): SubscriptionStatus {
  if (day < period.startsOn) {
    return 'UPCOMING';
  }
  return day > period.endsOn ? 'EXPIRED' : 'ACTIVE';
}

/** Active today; else one starting later; else one that ended; else none ever. */
export function subscriptionState(
  periods: { startsOn: string; endsOn: string }[],
  day: string,
): SubscriptionState {
  const statuses = new Set(periods.map((p) => subscriptionStatus(p, day)));
  if (statuses.has('ACTIVE')) {
    return 'ACTIVE';
  }
  if (statuses.has('UPCOMING')) {
    return 'UPCOMING';
  }
  return statuses.has('EXPIRED') ? 'EXPIRED' : 'NONE';
}
