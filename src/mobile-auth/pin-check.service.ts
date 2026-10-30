import { Injectable } from '@nestjs/common';
import { minutesUntil } from '../common/minutes-until.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { SystemSettingsService } from '../system-settings/system-settings.service.js';
import { invalidPin, pinLocked } from './mobile-auth.errors.js';
import { decidePinAttempt } from './pin-attempts.js';
import { PinHasher } from './pin-hasher.js';

/**
 * Checks a signed-in user's PIN to approve an action (an order confirmation,
 * 10b), with the sign-in rules: the same hash and pepper, and wrong attempts
 * counting toward the same `maxPinAttempts` lockout. A counted wrong attempt is
 * committed before the error is thrown, so retrying cannot erase it.
 */
@Injectable()
export class PinCheck {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SystemSettingsService,
    private readonly pinHasher: PinHasher,
  ) {}

  /** Resolves when the PIN is right; 400 INVALID_PIN or 403 PIN_LOCKED otherwise. */
  async verify(userId: string, pin: string): Promise<void> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { pinHash: true, pinLockedUntil: true },
    });
    const now = new Date();
    // Fast path only: the decision that counts is taken again under the lock.
    if (user?.pinLockedUntil && user.pinLockedUntil > now) {
      throw pinLocked(minutesUntil(user.pinLockedUntil, now));
    }
    // The slow scrypt work happens before the transaction (short row lock).
    // A session always has a PIN; a user without one simply cannot pass.
    const pinOk =
      user?.pinHash != null && (await this.pinHasher.verify(pin, user.pinHash));
    const { maxPinAttempts } = await this.settings.get();

    const decision = await this.prisma.$transaction((tx) =>
      decidePinAttempt(
        tx,
        userId,
        pinOk,
        user?.pinHash ?? null,
        maxPinAttempts,
        new Date(),
      ),
    );
    if (decision.kind === 'locked') {
      throw pinLocked(minutesUntil(decision.lockedUntil, new Date()));
    }
    if (decision.kind === 'invalid') {
      throw invalidPin();
    }
  }
}
