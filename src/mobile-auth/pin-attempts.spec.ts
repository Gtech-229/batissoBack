import type { Prisma } from '../generated/prisma/client.js';
import { decidePinAttempt } from './pin-attempts.js';

const HASH = 'hash-the-pin-was-checked-against';
const NOW = new Date('2026-10-30T10:00:00Z');

/** A transaction whose locked user row is `row`. */
function txWith(row: object) {
  const update = vi.fn().mockResolvedValue({});
  const tx = {
    $queryRaw: vi.fn().mockResolvedValue([row]),
    user: { update },
  };
  return { tx: tx as unknown as Prisma.TransactionClient, update };
}

const stored = {
  pinHash: HASH,
  pinLockedUntil: null,
  failedPinAttempts: 2,
};

describe('decidePinAttempt', () => {
  it('accepts a right PIN checked against the current hash', async () => {
    const { tx } = txWith(stored);

    await expect(
      decidePinAttempt(tx, 'user', true, HASH, 5, NOW),
    ).resolves.toEqual({ kind: 'ok' });
  });

  it('refuses a right PIN whose hash changed since, without counting it', async () => {
    const { tx, update } = txWith({ ...stored, pinHash: 'a-newer-hash' });

    await expect(
      decidePinAttempt(tx, 'user', true, HASH, 5, NOW),
    ).resolves.toEqual({ kind: 'invalid' });
    expect(update).not.toHaveBeenCalled();
  });

  it('refuses a right PIN after a reset wiped the hash', async () => {
    const { tx, update } = txWith({ ...stored, pinHash: null });

    await expect(
      decidePinAttempt(tx, 'user', true, HASH, 5, NOW),
    ).resolves.toEqual({ kind: 'invalid' });
    expect(update).not.toHaveBeenCalled();
  });

  it('still counts a wrong PIN checked against the current hash', async () => {
    const { tx, update } = txWith(stored);

    await decidePinAttempt(tx, 'user', false, HASH, 5, NOW);

    expect(update).toHaveBeenCalledWith({
      where: { id: 'user' },
      data: { failedPinAttempts: 3 },
    });
  });
});
