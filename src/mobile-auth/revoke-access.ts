import type { Prisma } from '../generated/prisma/client.js';

/**
 * Takes a person's access away, everywhere: live codes and verification tokens
 * retired, PIN wiped, sessions revoked, devices untrusted. The one path of a
 * manager reset (14a) and of a recovery with security answers (14b).
 */
export async function revokeAccess(
  tx: Prisma.TransactionClient,
  user: { id: string; phone: string },
  at: Date,
): Promise<{ sessionsRevoked: number; devicesUntrusted: number }> {
  // Before the user lock, the order of POST /auth/pin (token, then user): the
  // two cannot deadlock, and a token in flight dies here.
  await tx.phoneVerification.updateMany({
    where: { phone: user.phone, consumedAt: null },
    data: { consumedAt: at },
  });
  // Under this lock: a sign-in that passed its PIN check has committed its
  // session, so it is revoked below; a later one sees the hash is gone.
  await tx.$queryRaw`
    SELECT 1 FROM "users" WHERE "id" = ${user.id}::uuid FOR UPDATE`;
  await tx.user.update({
    where: { id: user.id },
    data: { pinHash: null, failedPinAttempts: 0, pinLockedUntil: null },
  });
  const { count: sessionsRevoked } = await tx.userSession.updateMany({
    where: { userId: user.id, revokedAt: null },
    data: { revokedAt: at },
  });
  // Rows are kept: sessions and notifications refer to them, and the next SMS
  // sign-in sets a new key.
  const { count: devicesUntrusted } = await tx.userDevice.updateMany({
    where: {
      userId: user.id,
      OR: [{ publicKey: { not: null } }, { pushToken: { not: null } }],
    },
    data: { publicKey: null, pushToken: null },
  });
  return { sessionsRevoked, devicesUntrusted };
}
