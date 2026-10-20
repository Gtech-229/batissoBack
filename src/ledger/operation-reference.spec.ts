import { formatDepositReference } from './operation-reference.js';

describe('formatDepositReference', () => {
  it('pads the sequence value to five digits', () => {
    expect(formatDepositReference(1n)).toBe('D-00001');
    expect(formatDepositReference(482n)).toBe('D-00482');
    expect(formatDepositReference(99999n)).toBe('D-99999');
  });

  it('grows past five digits instead of wrapping', () => {
    expect(formatDepositReference(100000n)).toBe('D-100000');
    expect(formatDepositReference(123456n)).toBe('D-123456');
  });
});
