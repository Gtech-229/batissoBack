import type { Prisma } from '../generated/prisma/client.js';
import { PIN_LOCK_DURATION_MS } from './mobile-auth.constants.js';

export type PinDecision =
  { kind: 'ok' } | { kind: 'invalid' } | { kind: 'locked'; lockedUntil: Date };

/**
 * Counts a PIN attempt under a row lock on the user, so parallel attempts are
 * judged one after another against the real lock state (the admin F-01
 * lesson). Reaching `maxPinAttempts` locks the user for 15 minutes, even with
 * the right PIN; `maxPinAttempts = 0` counts but never locks. The one PIN rule:
 * signing in and confirming an order (10b) both use it.
 */
export async function decidePinAttempt(
  tx: Prisma.TransactionClient,
  userId: string,
  pinOk: boolean,
  maxPinAttempts: number,
  now: Date,
): Promise<PinDecision> {
  // Raw SQL because Prisma has no row lock.
  const [row] = await tx.$queryRaw<
    { pinLockedUntil: Date | null; failedPinAttempts: number }[]
  >`
    SELECT "pinLockedUntil", "failedPinAttempts" FROM "users"
    WHERE "id" = ${userId}::uuid FOR UPDATE`;
  if (!row) {
    return { kind: 'invalid' };
  }
  if (row.pinLockedUntil && row.pinLockedUntil > now) {
    // Locked by a concurrent request: refused, and not counted again.
    return { kind: 'locked', lockedUntil: row.pinLockedUntil };
  }

  if (!pinOk) {
    const attempts = row.failedPinAttempts + 1;
    const reachesLimit = maxPinAttempts > 0 && attempts >= maxPinAttempts;
    await tx.user.update({
      where: { id: userId },
      data: reachesLimit
        ? {
            failedPinAttempts: 0,
            pinLockedUntil: new Date(now.getTime() + PIN_LOCK_DURATION_MS),
          }
        : { failedPinAttempts: attempts },
    });
    return { kind: 'invalid' };
  }

  await tx.user.update({
    where: { id: userId },
    data: { failedPinAttempts: 0, pinLockedUntil: null },
  });
  return { kind: 'ok' };
}
