import {
  MaterialOrderStatus,
  StoreMemberRole,
} from '../generated/prisma/client.js';

export interface PreparedOrderState {
  status: MaterialOrderStatus;
  /** True when the preparing manager's own order needed validation: preparing it validated it. */
  validatedByPreparer: boolean;
}

/**
 * The status of a newly prepared order, the one rule. Above the store's
 * validation threshold (strictly), a seller's order waits for the manager; the
 * manager's own order is validated by preparing it (user decision, 2026-10-26:
 * a store has a single manager). Otherwise it goes straight to the customer.
 */
export function preparedOrderState(
  total: bigint,
  validationThreshold: bigint,
  preparerRole: StoreMemberRole,
): PreparedOrderState {
  const needsValidation = total > validationThreshold;
  if (needsValidation && preparerRole === StoreMemberRole.SELLER) {
    return {
      status: MaterialOrderStatus.AWAITING_VALIDATION,
      validatedByPreparer: false,
    };
  }
  return {
    status: MaterialOrderStatus.AWAITING_CUSTOMER,
    validatedByPreparer: needsValidation,
  };
}
