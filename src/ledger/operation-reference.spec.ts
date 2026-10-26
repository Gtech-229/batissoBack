import { formatDepositReference } from './operation-reference.js';

describe('formatDepositReference', () => {
  it('gives "D-" and at least five digits', () => {
    expect(formatDepositReference(482n)).toBe('D-00482');
    expect(formatDepositReference(123456n)).toBe('D-123456');
  });
});
