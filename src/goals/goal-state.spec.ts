import { nextGoalState } from './goal-state.js';

const NOW = new Date('2026-10-22T10:00:00.000Z');
const BEFORE = new Date('2026-10-01T10:00:00.000Z');
const inProgress = (targetAmount: bigint | null) => ({
  status: 'IN_PROGRESS' as const,
  targetAmount,
  reachedAt: null,
});

describe('nextGoalState', () => {
  it('stays in progress below the target', () => {
    expect(nextGoalState(inProgress(150000n), 149999n, NOW)).toEqual({
      status: 'IN_PROGRESS',
      reachedAt: null,
      justReached: false,
    });
  });

  it.each([
    ['at', 150000n],
    ['above', 200000n],
  ])('becomes REACHED %s the target, and says it just did', (_, balance) => {
    expect(nextGoalState(inProgress(150000n), balance, NOW)).toEqual({
      status: 'REACHED',
      reachedAt: NOW,
      justReached: true,
    });
  });

  it('does not reach again a goal already REACHED', () => {
    const reached = {
      status: 'REACHED' as const,
      targetAmount: 150000n,
      reachedAt: BEFORE,
    };

    expect(nextGoalState(reached, 180000n, NOW)).toEqual({
      status: 'REACHED',
      reachedAt: BEFORE,
      justReached: false,
    });
  });

  it('goes back to IN_PROGRESS when the balance falls below the target', () => {
    const reached = {
      status: 'REACHED' as const,
      targetAmount: 150000n,
      reachedAt: BEFORE,
    };

    expect(nextGoalState(reached, 100000n, NOW)).toEqual({
      status: 'IN_PROGRESS',
      reachedAt: null,
      justReached: false,
    });
  });

  it('never reaches a goal without a target (the Unassigned goal)', () => {
    expect(nextGoalState(inProgress(null), 999999n, NOW).status).toBe(
      'IN_PROGRESS',
    );
  });

  it('keeps a closed goal closed', () => {
    const closed = {
      status: 'CLOSED' as const,
      targetAmount: 150000n,
      reachedAt: BEFORE,
    };

    expect(nextGoalState(closed, 200000n, NOW)).toEqual({
      status: 'CLOSED',
      reachedAt: BEFORE,
      justReached: false,
    });
  });
});
