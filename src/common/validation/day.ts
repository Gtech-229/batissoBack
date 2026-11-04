import { ValidateBy } from 'class-validator';

export const DAY_MESSAGE = 'La date doit être au format AAAA-MM-JJ';

const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/**
 * The start of a `YYYY-MM-DD` day in UTC, or null when no such day exists.
 * Year 0000 is refused: JavaScript has a year 0, PostgreSQL does not, and the
 * database would answer an error, a 500 (F-41, F-25).
 */
export function parseDay(day: string): Date | null {
  if (!DAY_PATTERN.test(day)) {
    return null;
  }
  const date = new Date(`${day}T00:00:00.000Z`);
  // `2026-02-30` parses to another day or to nothing: it must read back the same.
  return !Number.isNaN(date.getTime()) &&
    date.getUTCFullYear() >= 1 &&
    date.toISOString().slice(0, 10) === day
    ? date
    : null;
}

export function isDay(day: unknown): day is string {
  return typeof day === 'string' && parseDay(day) !== null;
}

/** A real `YYYY-MM-DD` calendar day (UTC), year 0001 to 9999. */
export function IsDay(): PropertyDecorator {
  return ValidateBy({
    name: 'isDay',
    validator: {
      validate: (value) => isDay(value),
      defaultMessage: () => DAY_MESSAGE,
    },
  });
}
