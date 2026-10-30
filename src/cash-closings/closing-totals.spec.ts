import { closingTotals } from './closing-totals.js';

describe('closingTotals', () => {
  it('is deposits minus corrections', () => {
    expect(
      closingTotals([
        { type: 'DEPOSIT', amount: 5000n },
        { type: 'DEPOSIT', amount: 2500n },
        { type: 'CORRECTION', amount: 1000n },
      ]),
    ).toEqual({
      depositsTotal: 7500n,
      correctionsTotal: 1000n,
      expectedTotal: 6500n,
    });
  });

  it('is zero with nothing to count', () => {
    expect(closingTotals([])).toEqual({
      depositsTotal: 0n,
      correctionsTotal: 0n,
      expectedTotal: 0n,
    });
  });

  it('is negative when only a correction was counted', () => {
    expect(
      closingTotals([{ type: 'CORRECTION', amount: 4500n }]).expectedTotal,
    ).toBe(-4500n);
  });
});
