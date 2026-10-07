import { StoreStatus } from '../generated/prisma/client.js';

export type StoreAction = 'verify' | 'suspend' | 'reactivate' | 'close';

interface Transition {
  /** Statuses this action is allowed from. */
  from: readonly StoreStatus[];
  to: StoreStatus;
  /** Suspending and closing must say why (shown to the store and in disputes). */
  needsReason: boolean;
}

/**
 * The store lifecycle, as data: anything not listed here is refused.
 * CLOSED appears in no `from`, so closing is final.
 */
export const STORE_TRANSITIONS: Record<StoreAction, Transition> = {
  verify: {
    from: [StoreStatus.PENDING],
    to: StoreStatus.VERIFIED,
    needsReason: false,
  },
  suspend: {
    from: [StoreStatus.VERIFIED],
    to: StoreStatus.SUSPENDED,
    needsReason: true,
  },
  reactivate: {
    from: [StoreStatus.SUSPENDED],
    to: StoreStatus.VERIFIED,
    needsReason: false,
  },
  close: {
    from: [StoreStatus.PENDING, StoreStatus.VERIFIED, StoreStatus.SUSPENDED],
    to: StoreStatus.CLOSED,
    needsReason: true,
  },
};

export function canTransition(action: StoreAction, from: StoreStatus): boolean {
  return STORE_TRANSITIONS[action].from.includes(from);
}

/** French labels for error messages. */
export const STORE_ACTION_LABELS: Record<StoreAction, string> = {
  verify: 'vérifier',
  suspend: 'suspendre',
  reactivate: 'réactiver',
  close: 'fermer',
};

export const STORE_STATUS_LABELS: Record<StoreStatus, string> = {
  PENDING: 'en attente de vérification',
  VERIFIED: 'vérifiée',
  SUSPENDED: 'suspendue',
  CLOSED: 'fermée',
};
