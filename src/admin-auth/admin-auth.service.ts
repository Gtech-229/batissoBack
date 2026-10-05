import { Injectable } from '@nestjs/common';
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

type LoginOutcome =
  | { kind: 'locked'; lockedUntil: Date }
  | { kind: 'invalid' }
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

    const passwordOk = await verifyPassword(
      password,
      admin?.passwordHash ?? (await this.getDummyHash()),
    );
    if (!admin) {
      // Same settings read and transaction as a wrong password on a real admin,
      // so the response time does not reveal whether the email exists (F-02).
      await this.decideLogin(NO_ADMIN_ID, false, undefined);
      throw invalidCredentials();
    }

    // Checked after the password so a deactivated account is only revealed to
    // someone who knows its password.
    if (passwordOk && !admin.isActive) {
      throw accountDisabled();
    }

    const outcome = await this.decideLogin(admin.id, passwordOk, userAgent);
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
   * Sets a new password, lifts the forced change, and signs out every other
   * session: a password change should cut off anyone using the old one.
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
    if (!(await verifyPassword(currentPassword, admin.passwordHash))) {
      throw invalidCredentials();
    }
    if (newPassword === currentPassword) {
      throw passwordUnchanged();
    }

    const passwordHash = await hashPassword(newPassword);
    const now = new Date();
    await this.prisma.$transaction([
      this.prisma.admin.update({
        where: { id: adminId },
        data: { passwordHash, mustChangePassword: false },
      }),
      this.prisma.adminSession.updateMany({
        where: { adminId, id: { not: sessionId }, revokedAt: null },
        data: { revokedAt: now },
      }),
    ]);
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
    userAgent: string | undefined,
  ): Promise<LoginOutcome> {
    const { maxLoginAttempts, maxAdminSessions } = await this.settings.get();
    const refresh = this.tokens.newRefreshSecret();

    const outcome = await this.prisma.$transaction(
      async (
        tx,
      ): Promise<LoginOutcome | { kind: 'opened'; sessionId: string }> => {
        // Raw SQL because Prisma has no row lock: FOR UPDATE makes every other
        // login of this admin wait here until this transaction ends.
        const [row] = await tx.$queryRaw<
          { lockedUntil: Date | null; failedLoginAttempts: number }[]
        >`SELECT "lockedUntil", "failedLoginAttempts" FROM "admins" WHERE "id" = ${adminId}::uuid FOR UPDATE`;
        const now = new Date();

        if (!row) {
          // Unknown email: same round trips as a counted failure, on no row.
          await tx.admin.updateMany({
            where: { id: adminId },
            data: { failedLoginAttempts: { increment: 1 } },
          });
          return { kind: 'invalid' };
        }

        if (row.lockedUntil && row.lockedUntil > now) {
          // Locked by a concurrent request: refused even with the right
          // password, and not counted as another failure.
          return { kind: 'locked', lockedUntil: row.lockedUntil };
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
    this.dummyHash ??= hashPassword('dummy-password-for-equal-timing');
    return this.dummyHash;
  }
}

function minutesUntil(date: Date, now: Date): number {
  return Math.max(1, Math.ceil((date.getTime() - now.getTime()) / 60_000));
}
