import type { HttpException } from '@nestjs/common';
import {
  cancellationRequestOpensAt,
  cancellationRequestRefusal,
  frenchDate,
  type RequestableOrder,
} from './cancellation-request.js';

describe('cancellationRequestOpensAt', () => {
  it('adds the delivery delay in whole days to the confirmation', () => {
    const confirmedAt = new Date('2026-10-28T10:15:30.250Z');

    expect(cancellationRequestOpensAt(confirmedAt, 30)).toEqual(
      new Date('2026-11-27T10:15:30.250Z'),
    );
    expect(cancellationRequestOpensAt(confirmedAt, 1)).toEqual(
      new Date('2026-10-29T10:15:30.250Z'),
    );
  });

  it('opens at the exact millisecond, not one before', () => {
    const confirmedAt = new Date('2026-01-01T00:00:00.000Z');
    const opensAt = cancellationRequestOpensAt(confirmedAt, 30);

    expect(opensAt.getTime() - confirmedAt.getTime()).toBe(30 * 86_400_000);
  });
});

describe('frenchDate', () => {
  it('writes jj/mm/aaaa in UTC', () => {
    expect(frenchDate(new Date('2026-11-27T10:15:30.250Z'))).toBe('27/11/2026');
    // Late on the 3rd in UTC is still the 3rd, whatever the server's zone.
    expect(frenchDate(new Date('2026-03-03T23:59:59.999Z'))).toBe('03/03/2026');
  });
});

describe('cancellationRequestRefusal', () => {
  const confirmedAt = new Date('2026-10-01T08:00:00.000Z');
  const order = (
    overrides: Partial<RequestableOrder> = {},
  ): RequestableOrder => ({
    status: 'CONFIRMED',
    confirmedAt,
    cancellationRequestedAt: null,
    store: { settings: { deliveryDelayDays: 30 } },
    ...overrides,
  });
  const codeOf = (error: HttpException | null) =>
    (error?.getResponse() as { error?: string } | undefined)?.error ?? null;

  it('allows a confirmed order once the delay has passed, from the exact millisecond', () => {
    expect(
      cancellationRequestRefusal(order(), new Date('2026-10-31T08:00:00.000Z')),
    ).toBeNull();
    expect(
      codeOf(
        cancellationRequestRefusal(
          order(),
          new Date('2026-10-31T07:59:59.999Z'),
        ),
      ),
    ).toBe('DELIVERY_DELAY_NOT_REACHED');
  });

  it('gives the date it opens in the message, from the store’s own delay', () => {
    const refusal = cancellationRequestRefusal(
      order({ store: { settings: { deliveryDelayDays: 45 } } }),
      new Date('2026-10-31T08:00:00.000Z'),
    );

    expect(refusal?.getResponse()).toMatchObject({
      error: 'DELIVERY_DELAY_NOT_REACHED',
      message:
        'Vous pourrez demander l’annulation de ce bon à partir du 15/11/2026',
    });
  });

  it('refuses another status first, then a second request', () => {
    const late = new Date('2027-01-01T00:00:00.000Z');

    expect(
      codeOf(cancellationRequestRefusal(order({ status: 'DELIVERED' }), late)),
    ).toBe('ORDER_STATUS');
    expect(
      codeOf(
        cancellationRequestRefusal(
          order({ cancellationRequestedAt: confirmedAt }),
          late,
        ),
      ),
    ).toBe('CANCELLATION_ALREADY_REQUESTED');
  });
});
