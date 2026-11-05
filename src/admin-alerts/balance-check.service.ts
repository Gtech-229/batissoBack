import { Injectable } from '@nestjs/common';
import { ONE_SNAPSHOT } from '../common/pagination.js';
import { AdminAlertType, type Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';

/** One snapshot for the whole run, with up to 60 s to read the ledger. */
export const BALANCE_CHECK_TRANSACTION = {
  ...ONE_SNAPSHOT,
  timeout: 60_000,
} as const;

/** What one run of the check did: counts only. */
export interface BalanceCheckResult {
  accountsChecked: number;
  alertsCreated: number;
}

interface Gap {
  storeId: string;
  accountId: string;
  goalId: string | null;
  difference: bigint;
}

/**
 * The nightly balance check (17a). It recomputes every account's and goal's
 * balance from the ledger (all operations are CONFIRMED: credits add, debits
 * subtract) and records each gap as an admin alert. It never writes a balance,
 * an operation or a goal: a fix stays a manager's correction (11a).
 */
@Injectable()
export class BalanceCheckService {
  constructor(private readonly prisma: PrismaService) {}

  async run(): Promise<BalanceCheckResult> {
    // REPEATABLE READ: the four reads see one snapshot, so a deposit committed
    // during the run cannot look like a gap. The transaction only reads.
    const { accountsChecked, gaps } = await this.prisma.$transaction(
      async (tx) => {
        const [{ count }] = await tx.$queryRaw<{ count: bigint }[]>`
          SELECT count(*)::bigint AS count FROM "accounts"`;
        return {
          accountsChecked: Number(count),
          gaps: [
            ...(await this.accountGaps(tx)).map((gap) =>
              toAlert(AdminAlertType.ACCOUNT_BALANCE_GAP, gap),
            ),
            ...(await this.goalGaps(tx)).map((gap) =>
              toAlert(AdminAlertType.GOAL_BALANCE_GAP, gap),
            ),
            ...(await this.goalSumGaps(tx)).map((gap) =>
              toAlert(AdminAlertType.GOAL_SUM_GAP, gap),
            ),
          ],
        };
      },
      // Prisma closes an interactive transaction after 5 s by default; the
      // four whole-ledger reads get more room as the ledger grows (F-59).
      BALANCE_CHECK_TRANSACTION,
    );

    // Outside the snapshot: ON CONFLICT DO NOTHING against the partial unique
    // index (one open alert per type, account and goal) skips a gap already
    // reported and not yet resolved. In REPEATABLE READ, a conflicting row
    // committed after the snapshot would fail instead of being skipped.
    const { count: alertsCreated } =
      gaps.length === 0
        ? { count: 0 }
        : await this.prisma.adminAlert.createMany({
            data: gaps,
            skipDuplicates: true,
          });
    return { accountsChecked, alertsCreated };
  }

  /** Account.balance against the sum of the account's operations. */
  private accountGaps(tx: Prisma.TransactionClient): Promise<Gap[]> {
    return tx.$queryRaw<Gap[]>`
      SELECT a."storeId", a."id" AS "accountId", NULL::uuid AS "goalId",
             (a."balance" - COALESCE(o."total", 0))::bigint AS "difference"
      FROM "accounts" a
      LEFT JOIN (
        SELECT "accountId",
               SUM(CASE WHEN "direction" = 'CREDIT' THEN "amount" ELSE -"amount" END) AS "total"
        FROM "operations" WHERE "status" = 'CONFIRMED'
        GROUP BY "accountId"
      ) o ON o."accountId" = a."id"
      WHERE a."balance" <> COALESCE(o."total", 0)`;
  }

  /** A goal's balance against its operations, plus moves in, minus moves out. */
  private goalGaps(tx: Prisma.TransactionClient): Promise<Gap[]> {
    return tx.$queryRaw<Gap[]>`
      SELECT a."storeId", g."accountId", g."id" AS "goalId",
             (g."balance" - (COALESCE(o."total", 0) + COALESCE(mi."total", 0)
                             - COALESCE(mo."total", 0)))::bigint AS "difference"
      FROM "goals" g
      JOIN "accounts" a ON a."id" = g."accountId"
      LEFT JOIN (
        SELECT "goalId",
               SUM(CASE WHEN "direction" = 'CREDIT' THEN "amount" ELSE -"amount" END) AS "total"
        FROM "operations" WHERE "status" = 'CONFIRMED'
        GROUP BY "goalId"
      ) o ON o."goalId" = g."id"
      LEFT JOIN (
        SELECT "targetGoalId" AS "goalId", SUM("amount") AS "total"
        FROM "goal_movements" GROUP BY "targetGoalId"
      ) mi ON mi."goalId" = g."id"
      LEFT JOIN (
        SELECT "sourceGoalId" AS "goalId", SUM("amount") AS "total"
        FROM "goal_movements" GROUP BY "sourceGoalId"
      ) mo ON mo."goalId" = g."id"
      WHERE g."balance" <> COALESCE(o."total", 0) + COALESCE(mi."total", 0)
                          - COALESCE(mo."total", 0)`;
  }

  /** The goals' balances against Account.balance. */
  private goalSumGaps(tx: Prisma.TransactionClient): Promise<Gap[]> {
    return tx.$queryRaw<Gap[]>`
      SELECT a."storeId", a."id" AS "accountId", NULL::uuid AS "goalId",
             (a."balance" - COALESCE(g."total", 0))::bigint AS "difference"
      FROM "accounts" a
      LEFT JOIN (
        SELECT "accountId", SUM("balance") AS "total"
        FROM "goals" GROUP BY "accountId"
      ) g ON g."accountId" = a."id"
      WHERE a."balance" <> COALESCE(g."total", 0)`;
  }
}

function toAlert(
  type: AdminAlertType,
  gap: Gap,
): Prisma.AdminAlertCreateManyInput {
  return {
    type,
    storeId: gap.storeId,
    accountId: gap.accountId,
    goalId: gap.goalId,
    difference: gap.difference,
  };
}
