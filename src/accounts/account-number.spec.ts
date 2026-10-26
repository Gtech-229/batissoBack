import { formatAccountNumber } from './account-number.js';

describe('formatAccountNumber', () => {
  it('gives "C-" and at least six digits', () => {
    expect(formatAccountNumber(123n)).toBe('C-000123');
    expect(formatAccountNumber(1234567n)).toBe('C-1234567');
  });
});
