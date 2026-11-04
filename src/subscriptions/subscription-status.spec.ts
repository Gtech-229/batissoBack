import {
  dateToDay,
  dayToDate,
  subscriptionState,
  subscriptionStatus,
  today,
} from './subscription-status.js';

const MARCH = { startsOn: '2026-03-01', endsOn: '2026-03-31' };

describe('subscription status', () => {
  it.each([
    ['2026-02-28', 'UPCOMING'],
    ['2026-03-01', 'ACTIVE'],
    ['2026-03-15', 'ACTIVE'],
    ['2026-03-31', 'ACTIVE'],
    ['2026-04-01', 'EXPIRED'],
  ])('on %s is %s (both ends included)', (day, status) => {
    expect(subscriptionStatus(MARCH, day)).toBe(status);
  });

  it('reads a one-day period as active on that day only', () => {
    const oneDay = { startsOn: '2026-03-10', endsOn: '2026-03-10' };

    expect(subscriptionStatus(oneDay, '2026-03-09')).toBe('UPCOMING');
    expect(subscriptionStatus(oneDay, '2026-03-10')).toBe('ACTIVE');
    expect(subscriptionStatus(oneDay, '2026-03-11')).toBe('EXPIRED');
  });
});

describe('store subscription state', () => {
  const APRIL = { startsOn: '2026-04-01', endsOn: '2026-04-30' };

  it('is NONE without any subscription', () => {
    expect(subscriptionState([], '2026-03-15')).toBe('NONE');
  });

  it('prefers ACTIVE over a later one', () => {
    expect(subscriptionState([APRIL, MARCH], '2026-03-15')).toBe('ACTIVE');
  });

  it('is UPCOMING between an ended one and a later one', () => {
    expect(
      subscriptionState(
        [MARCH, { startsOn: '2026-05-01', endsOn: '2026-05-31' }],
        '2026-04-15',
      ),
    ).toBe('UPCOMING');
  });

  it('is EXPIRED when every one has ended', () => {
    expect(subscriptionState([MARCH, APRIL], '2026-05-01')).toBe('EXPIRED');
  });
});

describe('days', () => {
  it('round-trips a day through a midnight UTC date', () => {
    expect(dayToDate('2026-03-31').toISOString()).toBe(
      '2026-03-31T00:00:00.000Z',
    );
    expect(dateToDay(dayToDate('2026-03-31'))).toBe('2026-03-31');
  });

  it('takes today as the UTC day, whatever the local time', () => {
    expect(today(new Date('2026-03-31T23:30:00.000-02:00'))).toBe('2026-04-01');
  });
});
