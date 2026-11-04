import { parseDay } from '../common/validation/day.js';

const DAY_MS = 24 * 60 * 60 * 1000;

/** A report's period: 366 days at most, so a leap year fits. */
export const MAX_PERIOD_DAYS = 366;

/** `start` included, `end` excluded. Days are UTC (no time zone on `Country`). */
export interface PeriodRange {
  start: Date;
  end: Date;
}

/**
 * The bounds of a period from two valid days, `to` included, or null when `from`
 * is after `to` or the period is longer than `MAX_PERIOD_DAYS`.
 */
export function periodRange(from: string, to: string): PeriodRange | null {
  const start = parseDay(from);
  const last = parseDay(to);
  if (!start || !last) {
    return null;
  }
  const end = new Date(last.getTime() + DAY_MS);
  const days = (end.getTime() - start.getTime()) / DAY_MS;
  return days >= 1 && days <= MAX_PERIOD_DAYS ? { start, end } : null;
}
