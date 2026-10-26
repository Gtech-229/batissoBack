import { formatSequenceNumber } from './sequence-number.js';

describe('formatSequenceNumber', () => {
  it('pads the sequence value to the minimum digits after the prefix', () => {
    expect(formatSequenceNumber('D', 5, 1n)).toBe('D-00001');
    expect(formatSequenceNumber('D', 5, 482n)).toBe('D-00482');
    expect(formatSequenceNumber('D', 5, 99999n)).toBe('D-99999');
  });

  it('grows past the minimum digits instead of wrapping', () => {
    expect(formatSequenceNumber('D', 5, 100000n)).toBe('D-100000');
    expect(formatSequenceNumber('C', 6, 1234567n)).toBe('C-1234567');
  });
});
