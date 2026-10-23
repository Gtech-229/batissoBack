/** Savings shown as material: how many units of an article an amount buys. */
export interface MaterialEquivalence {
  /** Whole units the balance buys at the price of the day. */
  quantity: bigint;
  /** Whole units the target buys; null when there is no target. */
  targetQuantity: bigint | null;
}

/**
 * Units of an article that a balance, and a target, buy at `price`. Rounded
 * down: a unit is bought whole or not at all. bigint division truncates,
 * which is rounding down for amounts that are never negative.
 */
export function materialEquivalence(
  balance: bigint,
  target: bigint | null,
  price: bigint,
): MaterialEquivalence {
  if (price <= 0n) {
    // The database refuses such a price (CHECK); never divide by it.
    throw new Error('A price must be positive');
  }
  return {
    quantity: balance / price,
    targetQuantity: target === null ? null : target / price,
  };
}
