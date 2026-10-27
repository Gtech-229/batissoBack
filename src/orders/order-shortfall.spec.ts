import { orderShortfall } from './order-shortfall.js';

describe('orderShortfall', () => {
  it('is the part of the total the goal does not hold', () => {
    expect(orderShortfall(50000n, 30000n, false)).toBe(20000n);
  });

  it('is zero when the goal holds more than the total, never negative', () => {
    expect(orderShortfall(20000n, 30000n, false)).toBe(0n);
  });

  it('is zero when the goal holds exactly the total', () => {
    expect(orderShortfall(30000n, 30000n, false)).toBe(0n);
  });

  it('is the whole total for an empty goal', () => {
    expect(orderShortfall(30000n, 0n, false)).toBe(30000n);
  });

  it('is zero when the goal is Unassigned itself', () => {
    expect(orderShortfall(50000n, 30000n, true)).toBe(0n);
  });
});
