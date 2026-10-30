import { Inject, Injectable, Logger } from '@nestjs/common';
import { generateKeyPairSync, randomBytes, randomInt } from 'node:crypto';
import {
  hashPassword,
  hashToken,
  verifyPassword,
} from '../admin-auth/secrets.js';
import { ACCESS_TOKEN_TTL_SECONDS } from '../admin-auth/admin-auth.constants.js';
import { TokensService } from '../admin-auth/tokens.service.js';
import type { AuthenticatedUser } from './authenticated-user.js';
import { minutesUntil } from '../common/minutes-until.js';
import { isPhoneCountry, normalizePhone } from '../common/phone.js';
import type { Prisma, User } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { SMS_SENDER, type SmsSender } from '../sms/sms-sender.js';
import { SystemSettingsService } from '../system-settings/system-settings.service.js';
import type { VerificationResponse } from './dto/code-responses.js';
import type { ChallengeResponse } from './dto/login.dto.js';
import type { MeResponse } from './dto/me.js';
import {
  toMobileUserProfile,
  type MobileSession,
} from './dto/mobile-session.js';
import {
  CHALLENGE_TTL_MS,
  CODE_COOLDOWN_MS,
  CODE_LENGTH,
  CODE_MAX_ATTEMPTS,
  CODE_TTL_MS,
  CODES_PER_DAY,
  CODES_PER_HOUR,
  REFRESH_TOKEN_TTL_MS,
  VERIFICATION_TTL_MS,
} from './mobile-auth.constants.js';
import {
  deviceVerificationRequired,
  invalidCode,
  invalidCredentials,
  invalidPhone,
  invalidRefreshToken,
  invalidVerification,
  notAuthenticated,
  pinLocked,
  pinUnchanged,
} from './mobile-auth.errors.js';
import { isValidDeviceSignature } from './device-key.js';
import { decidePinAttempt } from './pin-attempts.js';
import { PinCheck } from './pin-check.service.js';
import { PinHasher } from './pin-hasher.js';

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

// Matches no user: a device lookup for an unknown phone finds nothing, at the
// same cost as a real one.
const NO_USER_ID = '00000000-0000-0000-0000-000000000000';

/** `+22376000000` -> `+223******00`: enough to recognize a log line, not to reuse it. */
export function maskPhone(phone: string): string {
  return (
    phone.slice(0, 4) +
    '*'.repeat(Math.max(0, phone.length - 6)) +
    phone.slice(-2)
  );
}

/** The SMS a user receives. French, like every message users see. */
export function codeMessage(code: string): string {
  return `Bâtisso : votre code de connexion est ${code}. Il expire dans 10 minutes. Ne le partagez avec personne.`;
}

type CodeOutcome = { kind: 'invalid' } | { kind: 'verified'; token: string };

/** The PIN decision, taken under the user row lock. */
type Tx = Prisma.TransactionClient;

@Injectable()
export class MobileAuthService {
  // Compared against when there is no live code, so a wrong phone takes as long
  // as a wrong code and response times reveal nothing.
  private dummyHash?: Promise<string>;
  // A real P-256 key nobody holds the private half of: signatures are checked
  // against it when there is no device, so no signature ever matches it.
  private readonly dummyPublicKey = generateKeyPairSync('ec', {
    namedCurve: 'prime256v1',
  })
    .publicKey.export({ format: 'der', type: 'spki' })
    .toString('base64');
  private readonly logger = new Logger(MobileAuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(SMS_SENDER) private readonly sms: SmsSender,
    private readonly tokens: TokensService,
    private readonly settings: SystemSettingsService,
    private readonly pinHasher: PinHasher,
    private readonly pinCheck: PinCheck,
  ) {}

  /**
   * Sends a new code by SMS when the phone belongs to a user and the per-phone
   * limits allow it. Returns nothing either way: the caller always answers the
   * same, so this route cannot tell which phones have an account.
   */
  async requestCode(rawPhone: string): Promise<void> {
    const phone = await this.normalizeForActiveCountry(rawPhone);
    // Generated and hashed for every request, known phone or not, so the
    // response time does not reveal whether the phone has an account.
    const code = randomInt(0, 10 ** CODE_LENGTH)
      .toString()
      .padStart(CODE_LENGTH, '0');
    const codeHash = await hashPassword(code);
    if (!phone) {
      return;
    }

    const user = await this.prisma.user.findUnique({
      where: { phone },
      select: { id: true },
    });

    // The same transaction for every valid phone, known or not (F-15): only a
    // known phone within the limits writes, a residual of two quick writes.
    const created = await this.prisma.$transaction(async (tx) => {
      // One request per phone at a time: without it, two parallel requests
      // could both pass the cooldown and send two SMS.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('phone-verification:' || ${phone}))`;

      // The phone's codes of the last 24 hours, newest first: enough for the
      // cooldown, the hourly cap, and the daily cap.
      const now = Date.now();
      const lastDay = await tx.phoneVerification.findMany({
        where: { phone, createdAt: { gt: new Date(now - DAY_MS) } },
        orderBy: { createdAt: 'desc' },
        select: { createdAt: true },
      });
      const sentAgo = (index: number) =>
        now - lastDay[index].createdAt.getTime();
      const tooSoon = lastDay.length > 0 && sentAgo(0) < CODE_COOLDOWN_MS;
      const lastHourCount = lastDay.filter(
        (_code, index) => sentAgo(index) < HOUR_MS,
      ).length;
      // The daily cap bounds code guessing: at most 50 tries a day (F-14).
      if (
        !user ||
        tooSoon ||
        lastHourCount >= CODES_PER_HOUR ||
        lastDay.length >= CODES_PER_DAY
      ) {
        return false;
      }

      // Only the newest code works: asking again retires the previous one.
      await tx.phoneVerification.updateMany({
        where: { phone, verifiedAt: null, consumedAt: null },
        data: { consumedAt: new Date(now) },
      });
      await tx.phoneVerification.create({
        data: { phone, codeHash, expiresAt: new Date(now + CODE_TTL_MS) },
      });
      return true;
    });

    // After the commit, so the code exists before the user can type it, and not
    // awaited: the response time and outcome never depend on the provider, so
    // they cannot reveal which phones have an account (F-15).
    if (created) {
      this.sendCode(phone, code);
    }
  }

  /**
   * Starts sending the SMS without waiting for it. A provider failure is logged
   * (masked phone, error type only: never the text, which holds the code) and
   * never reaches the client; the user can ask for a new code.
   */
  private sendCode(phone: string, code: string): void {
    this.sms.send(phone, codeMessage(code)).catch((error: unknown) => {
      const kind = error instanceof Error ? error.name : 'unknown error';
      this.logger.error(`SMS to ${maskPhone(phone)} failed (${kind})`);
    });
  }

  /**
   * Checks the latest code of a phone. On success it turns into a single-use
   * verification token bound to this device, and tells whether the user still
   * has to choose a PIN. Every failure gives the same `INVALID_CODE`.
   */
  async verifyCode(
    rawPhone: string,
    code: string,
    deviceId: string,
  ): Promise<VerificationResponse> {
    const phone = await this.normalizeForActiveCountry(rawPhone);
    const outcome = phone
      ? await this.decideCode(phone, code, deviceId)
      : await this.noCode(code);
    if (outcome.kind === 'invalid' || !phone) {
      throw invalidCode();
    }

    const user = await this.prisma.user.findUnique({
      where: { phone },
      select: { pinHash: true },
    });
    if (!user) {
      throw invalidCode();
    }
    return {
      verificationToken: outcome.token,
      pinSet: user.pinHash !== null,
      expiresIn: VERIFICATION_TTL_MS / 1000,
    };
  }

  /**
   * The PIN step after a verified SMS code. Without a PIN yet, `pin` becomes the
   * user's PIN (activation); otherwise it must be the current PIN, counted in
   * the lockout. On success the device becomes trusted, a session opens on it,
   * and the verification token is used up. A wrong PIN keeps the token, so the
   * user can try again until it expires or the account locks.
   */
  async completeWithPin(
    verificationToken: string,
    pin: string,
    publicKey: string,
    deviceName: string | undefined,
  ): Promise<MobileSession> {
    const now = new Date();
    const verification = await this.prisma.phoneVerification.findUnique({
      where: { tokenHash: hashToken(verificationToken) },
    });
    if (
      !verification?.deviceId ||
      verification.consumedAt ||
      !verification.tokenExpiresAt ||
      verification.tokenExpiresAt <= now
    ) {
      throw invalidVerification();
    }
    const user = await this.prisma.user.findUnique({
      where: { phone: verification.phone },
    });
    if (!user) {
      throw invalidVerification();
    }
    // Fast path only: the decision that counts is taken again under the lock.
    if (user.pinHash && user.pinLockedUntil && user.pinLockedUntil > now) {
      throw pinLocked(minutesUntil(user.pinLockedUntil, now));
    }

    // The slow scrypt work happens before the transaction (short row locks).
    const step = user.pinHash
      ? {
          kind: 'check' as const,
          pinOk: await this.pinHasher.verify(pin, user.pinHash),
          checkedHash: user.pinHash,
        }
      : { kind: 'set' as const, pinHash: await this.pinHasher.hash(pin) };
    const { maxPinAttempts } = await this.settings.get();
    const refresh = this.tokens.newRefreshSecret();
    const deviceId = verification.deviceId;

    const outcome = await this.prisma.$transaction(async (tx) => {
      // Locked so two requests with the same token cannot both use it.
      const [token] = await tx.$queryRaw<
        { consumedAt: Date | null; tokenExpiresAt: Date | null }[]
      >`
        SELECT "consumedAt", "tokenExpiresAt" FROM "phone_verifications"
        WHERE "id" = ${verification.id}::uuid FOR UPDATE`;
      const at = new Date();
      if (
        !token ||
        token.consumedAt ||
        !token.tokenExpiresAt ||
        token.tokenExpiresAt <= at
      ) {
        return { kind: 'invalid-verification' as const };
      }

      if (step.kind === 'set') {
        // Another device may have activated the account meanwhile: never
        // overwrite a PIN the user already chose.
        const [row] = await tx.$queryRaw<{ pinHash: string | null }[]>`
          SELECT "pinHash" FROM "users" WHERE "id" = ${user.id}::uuid FOR UPDATE`;
        if (!row || row.pinHash !== null) {
          return { kind: 'invalid-verification' as const };
        }
        await tx.user.update({
          where: { id: user.id },
          data: {
            pinHash: step.pinHash,
            failedPinAttempts: 0,
            pinLockedUntil: null,
          },
        });
      } else {
        const decision = await decidePinAttempt(
          tx,
          user.id,
          step.pinOk,
          step.checkedHash,
          maxPinAttempts,
          at,
        );
        if (decision.kind !== 'ok') {
          return decision;
        }
      }

      await tx.phoneVerification.update({
        where: { id: verification.id },
        data: { consumedAt: at },
      });
      // Verified by SMS again (a reinstall, a new key): the new key replaces it.
      const sessionId = await this.openSession(
        tx,
        user.id,
        deviceId,
        { publicKey, name: deviceName },
        refresh.hash,
        at,
      );
      return { kind: 'opened' as const, sessionId };
    });

    // Thrown after the commit, so a counted wrong PIN is kept.
    switch (outcome.kind) {
      case 'invalid-verification':
        throw invalidVerification();
      case 'invalid':
        throw invalidCredentials();
      case 'locked':
        throw pinLocked(minutesUntil(outcome.lockedUntil, new Date()));
    }
    return this.toSession(user, outcome.sessionId, refresh.secret);
  }

  /**
   * A random value for a device to sign before `login`. Issued for any phone and
   * device, without looking anything up, so it reveals nothing about accounts.
   */
  async createChallenge(
    rawPhone: string,
    deviceId: string,
  ): Promise<ChallengeResponse> {
    // Stored as normalized when possible, so `login` can match it either way.
    const phone = (await this.normalizeForActiveCountry(rawPhone)) ?? rawPhone;
    const challenge = randomBytes(32).toString('base64url');
    await this.prisma.deviceChallenge.create({
      data: {
        phone,
        deviceId,
        challenge,
        expiresAt: new Date(Date.now() + CHALLENGE_TTL_MS),
      },
    });
    return { challenge, expiresIn: CHALLENGE_TTL_MS / 1000 };
  }

  /**
   * PIN sign-in on a trusted device. The device proves itself first: it signed a
   * fresh challenge with the private key registered at its SMS verification.
   * Any failure there is `DEVICE_VERIFICATION_REQUIRED`, before the PIN is even
   * looked at: without the phone, nobody can test PINs or lock the user out, and
   * every phone number gets the same answer. Then the PIN, with the lockout.
   */
  async login(
    rawPhone: string,
    pin: string,
    deviceId: string,
    challenge: string,
    signature: string,
  ): Promise<MobileSession> {
    const phone = await this.normalizeForActiveCountry(rawPhone);
    const now = new Date();

    // Used up by this attempt whatever happens next: one signature, one try.
    // A single conditional write, so two requests cannot both use it.
    const { count } = await this.prisma.deviceChallenge.updateMany({
      where: {
        challenge,
        phone: phone ?? rawPhone,
        deviceId,
        usedAt: null,
        expiresAt: { gt: now },
      },
      data: { usedAt: now },
    });
    // The same lookups and signature check on every path, whatever the
    // challenge, phone, or device (F-15): a missing device is checked against a
    // throwaway key, so every refusal costs the same work.
    const user = phone
      ? await this.prisma.user.findUnique({ where: { phone } })
      : null;
    const device = await this.prisma.userDevice.findUnique({
      where: { userId_deviceId: { userId: user?.id ?? NO_USER_ID, deviceId } },
      select: { publicKey: true },
    });
    const signatureOk = isValidDeviceSignature(
      device?.publicKey ?? this.dummyPublicKey,
      challenge,
      signature,
    );
    if (count !== 1 || !user?.pinHash || !device?.publicKey || !signatureOk) {
      throw deviceVerificationRequired();
    }

    // The device is proven: only now does the PIN count.
    // Fast path only: the decision that counts is taken again under the lock.
    if (user.pinLockedUntil && user.pinLockedUntil > now) {
      throw pinLocked(minutesUntil(user.pinLockedUntil, now));
    }
    const checkedHash = user.pinHash;
    const pinOk = await this.pinHasher.verify(pin, checkedHash);
    const { maxPinAttempts } = await this.settings.get();
    const refresh = this.tokens.newRefreshSecret();

    const outcome = await this.prisma.$transaction(async (tx) => {
      const at = new Date();
      const decision = await decidePinAttempt(
        tx,
        user.id,
        pinOk,
        checkedHash,
        maxPinAttempts,
        at,
      );
      if (decision.kind !== 'ok') {
        return decision;
      }
      const sessionId = await this.openSession(
        tx,
        user.id,
        deviceId,
        null,
        refresh.hash,
        at,
      );
      return { kind: 'opened' as const, sessionId };
    });

    switch (outcome.kind) {
      case 'invalid':
        throw invalidCredentials();
      case 'locked':
        throw pinLocked(minutesUntil(outcome.lockedUntil, new Date()));
    }
    return this.toSession(user, outcome.sessionId, refresh.secret);
  }

  /**
   * Renews a session: a new access token and a new refresh secret. The old
   * refresh token stops working, so a stolen copy used after the app is refused.
   */
  async refresh(refreshToken: string): Promise<MobileSession> {
    const parsed = this.tokens.parseRefreshToken(refreshToken);
    if (!parsed) {
      throw invalidRefreshToken();
    }
    const session = await this.prisma.userSession.findUnique({
      where: { id: parsed.sessionId },
      include: { user: true },
    });
    const now = new Date();
    if (
      !session ||
      session.revokedAt ||
      session.expiresAt <= now ||
      !this.tokens.secretMatches(parsed.secret, session.refreshTokenHash)
    ) {
      throw invalidRefreshToken();
    }

    const next = this.tokens.newRefreshSecret();
    // Guarded by the old hash: if two refreshes race with the same token, only
    // the first one rotates it; the second gets count 0 and is refused.
    const { count } = await this.prisma.userSession.updateMany({
      where: {
        id: session.id,
        refreshTokenHash: session.refreshTokenHash,
        revokedAt: null,
      },
      data: {
        refreshTokenHash: next.hash,
        expiresAt: new Date(now.getTime() + REFRESH_TOKEN_TTL_MS),
        lastUsedAt: now,
      },
    });
    if (count === 0) {
      throw invalidRefreshToken();
    }
    return this.toSession(session.user, session.id, next.secret);
  }

  /** Ends this session only. The device stays trusted: PIN sign-in still works. */
  async logout(sessionId: string): Promise<void> {
    await this.prisma.userSession.updateMany({
      where: { id: sessionId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  /**
   * Changes the signed-in user's PIN. The current PIN is checked like an order
   * confirmation (same lockout). Sessions on other devices end; this one stays,
   * and other devices stay trusted, so they sign in again with the new PIN.
   */
  async changePin(
    actor: AuthenticatedUser,
    currentPin: string,
    newPin: string,
  ): Promise<void> {
    if (currentPin === newPin) {
      throw pinUnchanged();
    }
    await this.pinCheck.verify(actor.userId, currentPin);
    // The slow scrypt work happens before the transaction (short row lock).
    const pinHash = await this.pinHasher.hash(newPin);

    const changed = await this.prisma.$transaction(async (tx) => {
      // A reset revokes this session under the same lock: the PIN it wiped must
      // not come back through a change that was already on its way.
      await tx.$queryRaw`
        SELECT 1 FROM "users" WHERE "id" = ${actor.userId}::uuid FOR UPDATE`;
      const live = await tx.userSession.count({
        where: { id: actor.sessionId, revokedAt: null },
      });
      if (live === 0) {
        return false;
      }
      await tx.user.update({
        where: { id: actor.userId },
        data: { pinHash, failedPinAttempts: 0, pinLockedUntil: null },
      });
      await tx.userSession.updateMany({
        where: {
          userId: actor.userId,
          id: { not: actor.sessionId },
          revokedAt: null,
        },
        data: { revokedAt: new Date() },
      });
      return true;
    });
    if (!changed) {
      throw notAuthenticated();
    }
  }

  /** The signed-in user and the stores they work in (active memberships). */
  async profile(userId: string): Promise<MeResponse> {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      include: {
        memberships: {
          where: { active: true },
          orderBy: { createdAt: 'asc' },
          include: { store: { select: { name: true } } },
        },
      },
    });
    // Fields listed one by one: never the PIN hash or the lockout state.
    return {
      id: user.id,
      firstName: user.firstName,
      lastName: user.lastName,
      phone: user.phone,
      memberships: user.memberships.map((membership) => ({
        storeId: membership.storeId,
        storeName: membership.store.name,
        role: membership.role,
      })),
    };
  }

  /** The response of a new session: tokens and the public profile. */
  private async toSession(
    user: User,
    sessionId: string,
    refreshSecret: string,
  ): Promise<MobileSession> {
    return {
      accessToken: await this.tokens.signUserAccessToken({
        sub: user.id,
        sid: sessionId,
      }),
      refreshToken: this.tokens.formatRefreshToken(sessionId, refreshSecret),
      expiresIn: ACCESS_TOKEN_TTL_SECONDS,
      user: toMobileUserProfile(user),
    };
  }

  /**
   * Opens a session on the device. With `trust` (after an SMS verification), the
   * device becomes trusted with that public key, replacing any previous one;
   * with `null` (PIN sign-in), the device is already trusted. One session per
   * user and device: an earlier one on the same device is revoked.
   */
  private async openSession(
    tx: Tx,
    userId: string,
    deviceId: string,
    trust: { publicKey: string; name: string | undefined } | null,
    refreshTokenHash: string,
    now: Date,
  ): Promise<string> {
    if (trust) {
      // ON CONFLICT DO NOTHING, then update: race-safe, unlike an upsert (F-07).
      await tx.userDevice.createMany({
        data: [{ userId, deviceId, trustedAt: now, lastSeenAt: now }],
        skipDuplicates: true,
      });
    }
    const device = await tx.userDevice.update({
      where: { userId_deviceId: { userId, deviceId } },
      data: trust
        ? {
            publicKey: trust.publicKey,
            name: trust.name,
            trustedAt: now,
            lastSeenAt: now,
          }
        : { lastSeenAt: now },
      select: { id: true },
    });

    await tx.userSession.updateMany({
      where: { deviceId: device.id, revokedAt: null },
      data: { revokedAt: now },
    });
    const session = await tx.userSession.create({
      data: {
        userId,
        deviceId: device.id,
        refreshTokenHash,
        expiresAt: new Date(now.getTime() + REFRESH_TOKEN_TTL_MS),
        createdAt: now,
        lastUsedAt: now,
      },
      select: { id: true },
    });
    return session.id;
  }

  private async decideCode(
    phone: string,
    code: string,
    deviceId: string,
  ): Promise<CodeOutcome> {
    // The slow scrypt comparison runs before the transaction, so the row lock
    // below is held only for a few quick queries.
    const latest = await this.prisma.phoneVerification.findFirst({
      where: { phone, verifiedAt: null, consumedAt: null },
      orderBy: { createdAt: 'desc' },
      select: { id: true, codeHash: true },
    });
    if (!latest) {
      return this.noCode(code);
    }
    const codeOk = await verifyPassword(code, latest.codeHash);

    return this.prisma.$transaction(async (tx) => {
      // Locked, then checked again: parallel tries are counted one by one, and a
      // code that died or was used meanwhile is refused even if it was right.
      const [row] = await tx.$queryRaw<
        {
          expiresAt: Date;
          attempts: number;
          verifiedAt: Date | null;
          consumedAt: Date | null;
        }[]
      >`
        SELECT "expiresAt", "attempts", "verifiedAt", "consumedAt"
        FROM "phone_verifications" WHERE "id" = ${latest.id}::uuid FOR UPDATE`;
      const now = new Date();
      const live =
        row !== undefined &&
        row.verifiedAt === null &&
        row.consumedAt === null &&
        row.expiresAt > now &&
        row.attempts < CODE_MAX_ATTEMPTS;
      if (!live) {
        return { kind: 'invalid' };
      }

      if (!codeOk) {
        const attempts = row.attempts + 1;
        await tx.phoneVerification.update({
          where: { id: latest.id },
          data: {
            attempts,
            // The last allowed try kills the code: a new one must be requested.
            consumedAt: attempts >= CODE_MAX_ATTEMPTS ? now : undefined,
          },
        });
        return { kind: 'invalid' };
      }

      const token = randomBytes(32).toString('base64url');
      await tx.phoneVerification.update({
        where: { id: latest.id },
        data: {
          verifiedAt: now,
          deviceId,
          tokenHash: hashToken(token),
          tokenExpiresAt: new Date(now.getTime() + VERIFICATION_TTL_MS),
        },
      });
      return { kind: 'verified', token };
    });
  }

  /** No live code for this phone: same scrypt work as a real comparison. */
  private async noCode(code: string): Promise<CodeOutcome> {
    await verifyPassword(code, await this.getDummyHash());
    return { kind: 'invalid' };
  }

  /** A real scrypt hash to compare against when there is nothing to compare. */
  private getDummyHash(): Promise<string> {
    this.dummyHash ??= hashPassword('dummy-secret-for-equal-timing');
    return this.dummyHash;
  }

  /**
   * E.164 form of a phone of the active country (one active country in V1).
   * Null when no country is active: no user can sign in then. A number that is
   * not valid for the active country is a 400 on the `phone` field.
   */
  private async normalizeForActiveCountry(raw: string): Promise<string | null> {
    const country = await this.prisma.country.findFirst({
      where: { active: true },
      select: { code: true },
    });
    if (!country || !isPhoneCountry(country.code)) {
      return null;
    }
    const phone = normalizePhone(raw, country.code);
    if (!phone) {
      throw invalidPhone();
    }
    return phone;
  }
}
