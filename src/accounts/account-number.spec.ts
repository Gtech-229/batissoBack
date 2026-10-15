import { formatAccountNumber } from './account-number.js';

describe('formatAccountNumber', () => {
  it('pads the sequence value to six digits', () => {
    expect(formatAccountNumber(1n)).toBe('C-000001');
    expect(formatAccountNumber(123n)).toBe('C-000123');
    expect(formatAccountNumber(999999n)).toBe('C-999999');
  });

  it('grows past six digits instead of wrapping', () => {
    expect(formatAccountNumber(1000000n)).toBe('C-1000000');
    expect(formatAccountNumber(1234567n)).toBe('C-1234567');
  });
});
