import { minutesUntil } from './minutes-until.js';

describe('minutesUntil', () => {
  const now = new Date('2026-10-07T10:00:00.000Z');
  const later = (ms: number) => new Date(now.getTime() + ms);

  it.each([
    [15 * 60_000, 15],
    [14 * 60_000 + 1, 15],
    [60_000, 1],
    [1, 1],
    [0, 1],
    [-5_000, 1],
  ])('%i ms left -> %i minute(s)', (ms, minutes) => {
    expect(minutesUntil(later(ms), now)).toBe(minutes);
  });
});
