import { Injectable, Logger } from '@nestjs/common';
import { AccountStatus } from '../generated/prisma/client.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { SystemSettingsService } from '../system-settings/system-settings.service.js';

const DAY_MS = 24 * 60 * 60 * 1000;

interface QuietAccount {
  id: string;
  customerId: string;
  storeId: string;
  number: string;
  storeName: string;
  /** When the quiet period started: the last deposit, or the opening. */
  start: Date;
}

/**
 * Inactivity reminders (17c), run every day. An account is quiet from its last
 * DEPOSIT (or its opening when it never had one); past the
 * `inactivityReminderDays` setting, its customer gets one reminder for that
 * period. The reminder never touches a balance.
 */
@Injectable()
export class InactivityRemindersService {
  private readonly logger = new Logger(InactivityRemindersService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    private readonly settings: SystemSettingsService,
  ) {}

  async remindQuietAccounts(
    now: Date = new Date(),
  ): Promise<{ accountsReminded: number }> {
    const { inactivityReminderDays } = await this.settings.get();
    const cutoff = new Date(now.getTime() - inactivityReminderDays * DAY_MS);
    // ACTIVE accounts of VERIFIED stores (the only ones that take deposits),
    // quiet since before the cutoff, with no reminder since that period began.
    const accounts = await this.prisma.$queryRaw<QuietAccount[]>`
      SELECT a."id", a."customerId", a."storeId", a."number",
             s."name" AS "storeName",
             COALESCE(d."last", a."createdAt") AS "start"
      FROM "accounts" a
      JOIN "hardware_stores" s ON s."id" = a."storeId"
      LEFT JOIN (
        SELECT "accountId", MAX("createdAt") AS "last"
        FROM "operations"
        WHERE "type" = 'DEPOSIT' AND "status" = 'CONFIRMED'
        GROUP BY "accountId"
      ) d ON d."accountId" = a."id"
      WHERE a."status" = 'ACTIVE' AND s."status" = 'VERIFIED'
        AND COALESCE(d."last", a."createdAt") <= ${cutoff}
        AND (a."inactivityRemindedAt" IS NULL
             OR a."inactivityRemindedAt" < COALESCE(d."last", a."createdAt"))
      ORDER BY "start" ASC`;

    let accountsReminded = 0;
    for (const account of accounts) {
      try {
        const ids = await this.prisma.$transaction(async (tx) => {
          // The claim: only an account still ACTIVE and not yet reminded for
          // this period matches, so a parallel run makes it a no-op.
          const { count } = await tx.account.updateMany({
            where: {
              id: account.id,
              status: AccountStatus.ACTIVE,
              OR: [
                { inactivityRemindedAt: null },
                { inactivityRemindedAt: { lt: account.start } },
              ],
            },
            data: { inactivityRemindedAt: now },
          });
          if (count === 0) {
            return null;
          }
          return this.notifications.recordInactivityReminder(tx, {
            customerId: account.customerId,
            storeId: account.storeId,
            storeName: account.storeName,
            accountNumber: account.number,
            days: Math.floor(
              (now.getTime() - account.start.getTime()) / DAY_MS,
            ),
          });
        });
        if (ids) {
          accountsReminded += 1;
          void this.notifications.dispatch(ids);
        }
      } catch (error) {
        // The message only: no account, phone or balance in the log.
        const message = error instanceof Error ? error.message : 'unknown';
        this.logger.error(`An inactivity reminder failed: ${message}`);
      }
    }
    return { accountsReminded };
  }
}
