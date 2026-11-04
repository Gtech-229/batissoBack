import { Injectable } from '@nestjs/common';
import { minutesUntil } from '../common/minutes-until.js';
import type { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { SystemSettingsService } from '../system-settings/system-settings.service.js';
import {
  LOCK_DURATION_MS,
  REFRESH_TOKEN_TTL_MS,
} from './admin-auth.constants.js';
import {
  accountDisabled,
  accountLocked,
  invalidCredentials,
  invalidRefreshToken,
  passwordUnchanged,
} from './admin-auth.errors.js';
import type { SessionCookies } from './cookies.js';
import { toAdminProfile, type AdminProfile } from './dto/admin-profile.js';
import { hashPassword, verifyPassword } from './secrets.js';
import { TokensService } from './tokens.service.js';

// Matches no admin: used to give unknown emails the same work as known ones.
const NO_ADMIN_ID = '00000000-0000-0000-0000-000000000000';

/**
 * Hashed for the equal-timing check. It is public (in the source), so matching
 * it never counts as a correct password (F-36). Exported for the tests.
 */
export const DUMMY_PASSWORD = 'dummy-password-for-equal-timing';

/** The lockout decision on one password attempt, taken under the row lock. */
type PasswordAttempt =
  { kind: 'ok' } | { kind: 'invalid' } | { kind: 'locked'; lockedUntil: Date };

type LoginOutcome =
  | Exclude<PasswordAttempt, { kind: 'ok' }>
  | { kind: 'success'; cookies: SessionCookies };

export interface LoginResult {
  profile: AdminProfile;
  cookies: SessionCookies;
}

@Injectable()
export class AdminAuthService {
  // Compared against when the email is unknown, so an unknown email takes as
  // long as a wrong password and response times reveal nothing.
  private dummyHash?: Promise<string>;

  constructor(
    private readonly prisma: PrismaService,
    private readonly tokens: TokensService,
    private readonly settings: SystemSettingsService,
  ) {}

  async login(
    email: string,
    password: string,
    userAgent: string | undefined,
  ): Promise<LoginResult> {
    const admin = await this.prisma.admin.findUnique({ where: { email } });

    // Fast path only: a request already known to be locked skips scrypt. The
    // decision that counts is taken again under the row lock below.
    if (admin?.lockedUntil && admin.lockedUntil > new Date()) {
      throw accountLocked(minutesUntil(admin.lockedUntil, new Date()));
    }

    // An admin who has not set a password yet (feature 22) gets the same work
    // as an unknown email, and the dummy check never counts as a match: the
    // dummy password is in the source (F-36).
    const storedHash = admin?.passwordHash ?? null;
    const matches = await verifyPassword(
      password,
      storedHash ?? (await this.getDummyHash()),
    );
    const passwordOk = storedHash !== null && matches;
    if (!admin) {
      // Same settings read and transaction as a wrong password on a real admin,
      // so the response time does not reveal whether the email exists (F-02).
      await this.decideLogin(NO_ADMIN_ID, false, null, undefined);
      throw invalidCredentials();
    }

    // Checked after the password so a deactivated account is only revealed to
    // someone who knows its password.
    if (passwordOk && !admin.isActive) {
      throw accountDisabled();
    }

    const outcome = await this.decideLogin(
      admin.id,
      passwordOk,
      storedHash,
      userAgent,
    );
    switch (outcome.kind) {
      case 'locked':
        throw accountLocked(minutesUntil(outcome.lockedUntil, new Date()));
      case 'invalid':
        throw invalidCredentials();
      case 'success':
        return { profile: toAdminProfile(admin), cookies: outcome.cookies };
    }
  }

  async refresh(refreshToken: unknown): Promise<SessionCookies> {
    const parsed = this.tokens.parseRefreshToken(refreshToken);
    if (!parsed) {
      throw invalidRefreshToken();
    }
    const session = await this.prisma.adminSession.findUnique({
      where: { id: parsed.sessionId },
      include: { admin: { select: { isActive: true } } },
    });
    const now = new Date();
    if (
      !session ||
      session.revokedAt ||
      session.expiresAt <= now ||
      !session.admin.isActive ||
      !this.tokens.secretMatches(parsed.secret, session.refreshTokenHash)
    ) {
      throw invalidRefreshToken();
    }

    const next = this.tokens.newRefreshSecret();
    // Guarded by the old hash: if two refreshes race with the same token, only
    // the first one rotates it; the second gets count 0 and is refused.
    const { count } = await this.prisma.adminSession.updateMany({
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

    return {
      accessToken: await this.tokens.signAccessToken({
        sub: session.adminId,
        sid: session.id,
      }),
      refreshToken: this.tokens.formatRefreshToken(session.id, next.secret),
    };
  }

  /** Revokes the session the refresh token belongs to. Unknown tokens are ignored. */
  async logout(refreshToken: unknown): Promise<void> {
    const parsed = this.tokens.parseRefreshToken(refreshToken);
    if (!parsed) {
      return;
    }
    const session = await this.prisma.adminSession.findUnique({
      where: { id: parsed.sessionId },
      select: { id: true, refreshTokenHash: true },
    });
    if (
      !session ||
      !this.tokens.secretMatches(parsed.secret, session.refreshTokenHash)
    ) {
      return;
    }
    await this.prisma.adminSession.updateMany({
      where: { id: session.id, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  async me(adminId: string): Promise<AdminProfile> {
    const admin = await this.prisma.admin.findUniqueOrThrow({
      where: { id: adminId },
    });
    return toAdminProfile(admin);
  }

  /**
   * Sets a new password and signs out every other session: a password change
   * should cut off anyone using the old one.
   */
  async changePassword(
    adminId: string,
    sessionId: string,
    currentPassword: string,
    newPassword: string,
  ): Promise<void> {
    const admin = await this.prisma.admin.findUniqueOrThrow({
      where: { id: adminId },
    });
    // Fast path only: the decision that counts is taken again under the lock.
    if (admin.lockedUntil && admin.lockedUntil > new Date()) {
      throw accountLocked(minutesUntil(admin.lockedUntil, new Date()));
    }

    // The slow scrypt work happens before the transaction (short row lock).
    const passwordOk =
      admin.passwordHash !== null &&
      (await verifyPassword(currentPassword, admin.passwordHash));
    const unchanged = newPassword === currentPassword;
    const passwordHash =
      passwordOk && !unchanged ? await hashPassword(newPassword) : null;
    const { maxLoginAttempts } = await this.settings.get();

    // A wrong current password counts in the same lockout as login (F-05):
    // a live session must not allow unlimited guesses of the password.
    const outcome = await this.prisma.$transaction(
      async (
        tx,
      ): Promise<PasswordAttempt | { kind: 'unchanged' | 'changed' }> => {
        const now = new Date();
        const attempt = await this.countPasswordAttempt(
          tx,
          adminId,
          passwordOk,
          admin.passwordHash,
          maxLoginAttempts,
          now,
        );
        if (attempt.kind !== 'ok') {
          return attempt;
        }
        if (!passwordHash) {
          return { kind: 'unchanged' };
        }
        await tx.admin.update({
          where: { id: adminId },
          data: { passwordHash },
        });
        await tx.adminSession.updateMany({
          where: { adminId, id: { not: sessionId }, revokedAt: null },
          data: { revokedAt: now },
        });
        return { kind: 'changed' };
      },
    );

    // Thrown after the commit, so a counted failure is kept.
    switch (outcome.kind) {
      case 'locked':
        throw accountLocked(minutesUntil(outcome.lockedUntil, new Date()));
      case 'invalid':
        throw invalidCredentials();
      case 'unchanged':
        throw passwordUnchanged();
    }
  }

  /**
   * Counts one password attempt under a row lock on the admin, for login and
   * password change alike, so parallel attempts are judged one after another
   * against the real lock state (F-01). A locked admin is refused even with the
   * right password, without counting; a failure counts and locks at
   * `maxLoginAttempts`; a success resets the counter. An id that matches no
   * admin gets the same round trips as a counted failure (F-02).
   *
   * A verdict is about one hash: `verifiedHash` is the one the password was
   * checked against. If a reset replaced it before the lock, the attempt is
   * refused without counting, so a sign-in that started before the reset
   * cannot open a session with the old password (F-37).
   */
  private async countPasswordAttempt(
    tx: Prisma.TransactionClient,
    adminId: string,
    passwordOk: boolean,
    verifiedHash: string | null,
    maxLoginAttempts: number,
    now: Date,
  ): Promise<PasswordAttempt> {
    // Raw SQL because Prisma has no row lock: FOR UPDATE makes every other
    // attempt on this admin wait here until this transaction ends.
    const [row] = await tx.$queryRaw<
      {
        lockedUntil: Date | null;
        failedLoginAttempts: number;
        passwordHash: string | null;
      }[]
    >`SELECT "lockedUntil", "failedLoginAttempts", "passwordHash" FROM "admins" WHERE "id" = ${adminId}::uuid FOR UPDATE`;

    if (!row) {
      await tx.admin.updateMany({
        where: { id: adminId },
        data: { failedLoginAttempts: { increment: 1 } },
      });
      return { kind: 'invalid' };
    }

    if (row.lockedUntil && row.lockedUntil > now) {
      return { kind: 'locked', lockedUntil: row.lockedUntil };
    }

    if (row.passwordHash !== verifiedHash) {
      return { kind: 'invalid' };
    }

    if (!passwordOk) {
      const attempts = row.failedLoginAttempts + 1;
      const reachesLimit = attempts >= maxLoginAttempts;
      await tx.admin.update({
        where: { id: adminId },
        data: reachesLimit
          ? {
              failedLoginAttempts: 0,
              lockedUntil: new Date(now.getTime() + LOCK_DURATION_MS),
            }
          : { failedLoginAttempts: attempts },
      });
      return { kind: 'invalid' };
    }

    await tx.admin.update({
      where: { id: adminId },
      data: { failedLoginAttempts: 0, lockedUntil: null },
    });
    return { kind: 'ok' };
  }

  /**
   * Takes the login decision under a row lock on the admin, so concurrent
   * attempts are judged one after another against the real lock state.
   * Errors are returned, not thrown, so a recorded failure is committed
   * instead of being rolled back with the transaction.
   */
  private async decideLogin(
    adminId: string,
    passwordOk: boolean,
    verifiedHash: string | null,
    userAgent: string | undefined,
  ): Promise<LoginOutcome> {
    const { maxLoginAttempts, maxAdminSessions } = await this.settings.get();
    const refresh = this.tokens.newRefreshSecret();

    const outcome = await this.prisma.$transaction(
      async (
        tx,
      ): Promise<LoginOutcome | { kind: 'opened'; sessionId: string }> => {
        const now = new Date();
        const attempt = await this.countPasswordAttempt(
          tx,
          adminId,
          passwordOk,
          verifiedHash,
          maxLoginAttempts,
          now,
        );
        if (attempt.kind !== 'ok') {
          return attempt;
        }

        const session = await tx.adminSession.create({
          data: {
            adminId: adminId,
            refreshTokenHash: refresh.hash,
            expiresAt: new Date(now.getTime() + REFRESH_TOKEN_TTL_MS),
            userAgent: userAgent?.slice(0, 255),
          },
        });

        // Over the cap: revoke the oldest active sessions, keep the newest ones.
        const active = await tx.adminSession.findMany({
          where: { adminId: adminId, revokedAt: null, expiresAt: { gt: now } },
          orderBy: { createdAt: 'desc' },
          select: { id: true },
        });
        const extra = active.slice(maxAdminSessions).map(({ id }) => id);
        if (extra.length > 0) {
          await tx.adminSession.updateMany({
            where: { id: { in: extra } },
            data: { revokedAt: now },
          });
        }
        return { kind: 'opened', sessionId: session.id };
      },
    );

    if (outcome.kind !== 'opened') {
      return outcome;
    }
    return {
      kind: 'success',
      cookies: {
        accessToken: await this.tokens.signAccessToken({
          sub: adminId,
          sid: outcome.sessionId,
        }),
        refreshToken: this.tokens.formatRefreshToken(
          outcome.sessionId,
          refresh.secret,
        ),
      },
    };
  }

  private getDummyHash(): Promise<string> {
    this.dummyHash ??= hashPassword(DUMMY_PASSWORD);
    return this.dummyHash;
  }
}
