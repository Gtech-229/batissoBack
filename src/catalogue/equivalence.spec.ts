import { materialEquivalence } from './equivalence.js';

describe('materialEquivalence', () => {
  it('gives the units an exact balance and target buy', () => {
    expect(materialEquivalence(30000n, 150000n, 5000n)).toEqual({
      quantity: 6n,
      targetQuantity: 30n,
    });
  });

  it('rounds down: a unit is bought whole or not at all', () => {
    expect(materialEquivalence(34999n, 152500n, 5000n)).toEqual({
      quantity: 6n,
      targetQuantity: 30n,
    });
  });

  it('gives 0 units for a balance below the price', () => {
    expect(materialEquivalence(0n, 4999n, 5000n)).toEqual({
      quantity: 0n,
      targetQuantity: 0n,
    });
  });

  it('gives no target quantity without a target', () => {
    expect(materialEquivalence(10000n, null, 5000n)).toEqual({
      quantity: 2n,
      targetQuantity: null,
    });
  });

  it('stays exact beyond 2^53', () => {
    expect(materialEquivalence(999999999999999999n, null, 1n).quantity).toBe(
      999999999999999999n,
    );
  });

  it.each([0n, -1n])('refuses a price of %s', (price) => {
    expect(() => materialEquivalence(1000n, null, price)).toThrow(
      'A price must be positive',
    );
  });
});
