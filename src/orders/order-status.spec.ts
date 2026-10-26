import { preparedOrderState } from './order-status.js';

describe('preparedOrderState', () => {
  it('sends a seller’s order above the threshold to the manager', () => {
    expect(preparedOrderState(200001n, 200000n, 'SELLER')).toEqual({
      status: 'AWAITING_VALIDATION',
      validatedByPreparer: false,
    });
  });

  it('sends an order equal to the threshold straight to the customer', () => {
    expect(preparedOrderState(200000n, 200000n, 'SELLER')).toEqual({
      status: 'AWAITING_CUSTOMER',
      validatedByPreparer: false,
    });
  });

  it('counts the manager’s own order above the threshold as validated', () => {
    expect(preparedOrderState(500000n, 200000n, 'MANAGER')).toEqual({
      status: 'AWAITING_CUSTOMER',
      validatedByPreparer: true,
    });
  });

  it('records no validation for a manager’s order under the threshold', () => {
    expect(preparedOrderState(1000n, 200000n, 'MANAGER')).toEqual({
      status: 'AWAITING_CUSTOMER',
      validatedByPreparer: false,
    });
  });
});
