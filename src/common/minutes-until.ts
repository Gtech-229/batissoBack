/** Whole minutes left until `date`, at least 1: for "try again in N minutes". */
export function minutesUntil(date: Date, now: Date): number {
  return Math.max(1, Math.ceil((date.getTime() - now.getTime()) / 60_000));
}
