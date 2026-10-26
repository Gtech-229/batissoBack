import { formatOrderReference } from './order-reference.js';

describe('formatOrderReference', () => {
  it('gives "B-" and at least five digits', () => {
    expect(formatOrderReference(42n)).toBe('B-00042');
    expect(formatOrderReference(100000n)).toBe('B-100000');
  });
});
