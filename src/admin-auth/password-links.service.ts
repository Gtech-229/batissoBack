import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { EnvironmentVariables } from '../config/env.validation.js';
import { EMAIL_SENDER, type EmailSender } from '../email/email-sender.js';
import {
  AdminRole,
  PasswordTokenMode,
  type Prisma,
} from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import {
  PASSWORD_LINK_COOLDOWN_MS,
  PASSWORD_TOKEN_TTL_MS,
} from './admin-auth.constants.js';
import { invalidPasswordToken } from './admin-auth.errors.js';
import {
  newPasswordToken,
  passwordLink,
  passwordLinkEmail,
  toTokenMode,
  type PasswordLinkMode,
} from './password-link.js';
import { hashPassword, hashToken } from './secrets.js';

export const PASSWORD_LINK_REQUESTED =
  'Si un compte correspond à cet email, un lien vient de lui être envoyé.';

/**
 * The emailed password links (feature 22): an admin asks for one to set a
 * first password (`set`) or replace a forgotten one (`reset`), then sends the
 * token back with the new password.
 */
@Injectable()
export class PasswordLinksService {
  private readonly logger = new Logger('PasswordLinks');
  private readonly adminWebUrl: string;

  constructor(
    private readonly prisma: PrismaService,
    @Inject(EMAIL_SENDER) private readonly email: EmailSender,
    config: ConfigService<EnvironmentVariables, true>,
  ) {
    this.adminWebUrl = config.get('ADMIN_WEB_URL', { infer: true });
  }

  /**
   * Emails a link when the admin exists, is active, fits the mode (`set`: no
   * password yet; `reset`: one exists) and had none in the last minute.
   * Otherwise nothing happens; the caller answers the same either way.
   */
  async request(mode: PasswordLinkMode, email: string): Promise<void> {
    const token = newPasswordToken();
    const tokenHash = hashToken(token);

    // The same transaction for every email, known or not: only a fitting admin
    // writes, a residual of two quick writes.
    const admin = await this.prisma.$transaction(async (tx) => {
      // One request per email at a time, so two parallel requests cannot both
      // pass the cooldown and send two emails.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('admin-password-link:' || ${email}))`;
      const found = await tx.admin.findUnique({
        where: { email },
        select: {
          id: true,
          email: true,
          firstName: true,
          isActive: true,
          passwordHash: true,
        },
      });
      const last = await tx.adminPasswordToken.findFirst({
        where: { admin: { email } },
        orderBy: { createdAt: 'desc' },
        select: { createdAt: true },
      });
      const now = Date.now();
      const fits =
        found?.isActive === true &&
        (mode === 'set'
          ? found.passwordHash === null
          : found.passwordHash !== null);
      const tooSoon =
        last !== null &&
        now - last.createdAt.getTime() < PASSWORD_LINK_COOLDOWN_MS;
      if (!found || !fits || tooSoon) {
        return null;
      }

      await this.issue(tx, found.id, mode, tokenHash, now);
      return found;
    });
    if (!admin) {
      return;
    }

    // After the commit and not awaited: the provider's delay must not tell a
    // caller whether the email has an account. The log names no address or link.
    const link = passwordLink(this.adminWebUrl, mode, token);
    void this.email
      .send(passwordLinkEmail(admin.email, admin.firstName, mode, link))
      .catch((error: unknown) => {
        this.logger.error(
          `Password email not sent: ${error instanceof Error ? error.message : 'unknown error'}`,
        );
      });
  }

  /**
   * For the server command: a link for an active super admin who cannot
   * receive email, returned instead of emailed. `set` when they have no
   * password, `reset` otherwise; no cooldown, since only someone on the server
   * can run it. Null for anyone else.
   */
  async superAdminLink(email: string): Promise<string | null> {
    const admin = await this.prisma.admin.findUnique({
      where: { email },
      select: { id: true, role: true, isActive: true, passwordHash: true },
    });
    if (!admin || admin.role !== AdminRole.SUPER_ADMIN || !admin.isActive) {
      return null;
    }
    const mode: PasswordLinkMode =
      admin.passwordHash === null ? 'set' : 'reset';
    const token = newPasswordToken();
    await this.prisma.$transaction((tx) =>
      this.issue(tx, admin.id, mode, hashToken(token), Date.now()),
    );
    return passwordLink(this.adminWebUrl, mode, token);
  }

  /** Stores a new link; only the newest works, so the previous ones retire. */
  private async issue(
    tx: Prisma.TransactionClient,
    adminId: string,
    mode: PasswordLinkMode,
    tokenHash: string,
    now: number,
  ): Promise<void> {
    await tx.adminPasswordToken.updateMany({
      where: { adminId, usedAt: null },
      data: { usedAt: new Date(now) },
    });
    await tx.adminPasswordToken.create({
      data: {
        adminId,
        mode: toTokenMode(mode),
        tokenHash,
        expiresAt: new Date(now + PASSWORD_TOKEN_TTL_MS),
      },
    });
  }

  /**
   * Sets the password from a link. In one transaction: the token is consumed
   * (two uses cannot both pass), the password set, every session of the admin
   * ended and the lockout cleared.
   */
  async usePasswordToken(token: string, password: string): Promise<void> {
    const stored = await this.prisma.adminPasswordToken.findUnique({
      where: { tokenHash: hashToken(token) },
      select: {
        id: true,
        adminId: true,
        mode: true,
        expiresAt: true,
        usedAt: true,
        admin: { select: { isActive: true } },
      },
    });
    if (
      !stored ||
      stored.usedAt ||
      stored.expiresAt <= new Date() ||
      !stored.admin.isActive
    ) {
      throw invalidPasswordToken();
    }

    // The slow scrypt work happens before the transaction.
    const passwordHash = await hashPassword(password);

    const ok = await this.prisma.$transaction(async (tx) => {
      const now = new Date();
      const consumed = await tx.adminPasswordToken.updateMany({
        where: { id: stored.id, usedAt: null, expiresAt: { gt: now } },
        data: { usedAt: now },
      });
      if (consumed.count === 0) {
        return false;
      }
      // A set link no longer fits once the admin has a password; the refused
      // link stays spent.
      const updated = await tx.admin.updateMany({
        where: {
          id: stored.adminId,
          isActive: true,
          ...(stored.mode === PasswordTokenMode.SET
            ? { passwordHash: null }
            : {}),
        },
        data: { passwordHash, failedLoginAttempts: 0, lockedUntil: null },
      });
      if (updated.count === 0) {
        return false;
      }
      await tx.adminSession.updateMany({
        where: { adminId: stored.adminId, revokedAt: null },
        data: { revokedAt: now },
      });
      return true;
    });
    if (!ok) {
      throw invalidPasswordToken();
    }
  }
}
