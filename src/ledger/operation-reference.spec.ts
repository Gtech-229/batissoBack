import {
  formatDepositReference,
  formatPurchaseReference,
} from './operation-reference.js';

describe('formatDepositReference', () => {
  it('gives "D-" and at least five digits', () => {
    expect(formatDepositReference(482n)).toBe('D-00482');
    expect(formatDepositReference(123456n)).toBe('D-123456');
  });
});

describe('formatPurchaseReference', () => {
  it('gives "A-" and at least five digits', () => {
    expect(formatPurchaseReference(1n)).toBe('A-00001');
    expect(formatPurchaseReference(123456n)).toBe('A-123456');
  });
});
