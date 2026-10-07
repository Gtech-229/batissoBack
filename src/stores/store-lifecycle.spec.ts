import { StoreStatus } from '../generated/prisma/client.js';
import {
  canTransition,
  STORE_TRANSITIONS,
  type StoreAction,
} from './store-lifecycle.js';

const { PENDING, VERIFIED, SUSPENDED, CLOSED } = StoreStatus;

describe('store lifecycle', () => {
  // Every (action, current status) pair, with the expected answer.
  it.each<[StoreAction, StoreStatus, boolean]>([
    ['verify', PENDING, true],
    ['verify', VERIFIED, false],
    ['verify', SUSPENDED, false],
    ['verify', CLOSED, false],
    ['suspend', PENDING, false],
    ['suspend', VERIFIED, true],
    ['suspend', SUSPENDED, false],
    ['suspend', CLOSED, false],
    ['reactivate', PENDING, false],
    ['reactivate', VERIFIED, false],
    ['reactivate', SUSPENDED, true],
    ['reactivate', CLOSED, false],
    ['close', PENDING, true],
    ['close', VERIFIED, true],
    ['close', SUSPENDED, true],
    ['close', CLOSED, false],
  ])('%s from %s -> %s', (action, from, allowed) => {
    expect(canTransition(action, from)).toBe(allowed);
  });

  it('leads each action to the right status', () => {
    expect(STORE_TRANSITIONS.verify.to).toBe(VERIFIED);
    expect(STORE_TRANSITIONS.suspend.to).toBe(SUSPENDED);
    expect(STORE_TRANSITIONS.reactivate.to).toBe(VERIFIED);
    expect(STORE_TRANSITIONS.close.to).toBe(CLOSED);
  });

  it('requires a reason only to suspend or close', () => {
    expect(STORE_TRANSITIONS.suspend.needsReason).toBe(true);
    expect(STORE_TRANSITIONS.close.needsReason).toBe(true);
    expect(STORE_TRANSITIONS.verify.needsReason).toBe(false);
    expect(STORE_TRANSITIONS.reactivate.needsReason).toBe(false);
  });

  it('makes closing final: no action starts from CLOSED', () => {
    for (const transition of Object.values(STORE_TRANSITIONS)) {
      expect(transition.from).not.toContain(CLOSED);
    }
  });
});
