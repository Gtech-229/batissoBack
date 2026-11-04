import { isDay, parseDay } from './day.js';

describe('isDay', () => {
  it.each(['2026-10-31', '2024-02-29', '0001-01-01', '9999-12-31'])(
    'accepts %s',
    (day) => {
      expect(isDay(day)).toBe(true);
    },
  );

  it.each([
    '2026-02-30',
    '2025-02-29',
    '2026-13-01',
    '2026-1-1',
    '31/10/2026',
    '2026-10-31T00:00:00Z',
    // PostgreSQL has no year 0 (F-41, F-25).
    '0000-01-01',
    '0000-12-31',
    '',
    20261031,
    null,
  ])('refuses %s', (day) => {
    expect(isDay(day)).toBe(false);
  });
});

describe('parseDay', () => {
  it('gives the start of the day in UTC', () => {
    expect(parseDay('2026-10-31')).toEqual(
      new Date('2026-10-31T00:00:00.000Z'),
    );
  });
});
