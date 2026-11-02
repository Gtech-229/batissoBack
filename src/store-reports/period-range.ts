const DAY_MS = 24 * 60 * 60 * 1000;

/** A report's period: 366 days at most, so a leap year fits. */
export const MAX_PERIOD_DAYS = 366;

const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/** The start of a `YYYY-MM-DD` day in UTC, or null when no such day exists. */
function startOfDay(day: string): Date | null {
  if (!DAY_PATTERN.test(day)) {
    return null;
  }
  const date = new Date(`${day}T00:00:00.000Z`);
  // `2026-02-30` parses to another day or to nothing: it must read back the same.
  return !Number.isNaN(date.getTime()) &&
    date.toISOString().slice(0, 10) === day
    ? date
    : null;
}

export function isDay(day: unknown): day is string {
  return typeof day === 'string' && startOfDay(day) !== null;
}

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
  const start = startOfDay(from);
  const last = startOfDay(to);
  if (!start || !last) {
    return null;
  }
  const end = new Date(last.getTime() + DAY_MS);
  const days = (end.getTime() - start.getTime()) / DAY_MS;
  return days >= 1 && days <= MAX_PERIOD_DAYS ? { start, end } : null;
}
