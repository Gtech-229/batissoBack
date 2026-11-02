import { isDay, periodRange } from './period-range.js';

describe('isDay', () => {
  it.each(['2026-10-31', '2024-02-29'])('accepts %s', (day) => {
    expect(isDay(day)).toBe(true);
  });

  it.each([
    '2026-02-30',
    '2025-02-29',
    '2026-13-01',
    '2026-1-1',
    '31/10/2026',
    '2026-10-31T00:00:00Z',
    '',
    20261031,
    null,
  ])('refuses %j', (day) => {
    expect(isDay(day)).toBe(false);
  });
});

describe('periodRange', () => {
  it('runs from the start of `from` to the end of `to`, in UTC', () => {
    expect(periodRange('2026-10-01', '2026-10-31')).toEqual({
      start: new Date('2026-10-01T00:00:00.000Z'),
      end: new Date('2026-11-01T00:00:00.000Z'),
    });
  });

  it('accepts a single day', () => {
    expect(periodRange('2026-10-31', '2026-10-31')).toEqual({
      start: new Date('2026-10-31T00:00:00.000Z'),
      end: new Date('2026-11-01T00:00:00.000Z'),
    });
  });

  it('refuses `from` after `to`', () => {
    expect(periodRange('2026-11-01', '2026-10-31')).toBeNull();
  });

  it('accepts 366 days and refuses 367', () => {
    expect(periodRange('2024-01-01', '2024-12-31')).not.toBeNull();
    expect(periodRange('2024-01-01', '2025-01-01')).toBeNull();
  });
});
