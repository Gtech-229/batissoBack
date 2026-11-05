import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { BalanceCheckService } from './balance-check.service.js';

/** The job's name in the SchedulerRegistry. */
export const BALANCE_CHECK_JOB = 'balance-check';

/**
 * Runs the balance check every night at 02:00 UTC (17a; Mali and Côte d'Ivoire
 * are on UTC). One API instance in V1, so no cross-process lock.
 */
@Injectable()
export class BalanceCheckJob {
  private readonly logger = new Logger(BalanceCheckJob.name);

  constructor(private readonly check: BalanceCheckService) {}

  @Cron('0 2 * * *', { name: BALANCE_CHECK_JOB, timeZone: 'UTC' })
  async handle(): Promise<void> {
    try {
      const { accountsChecked, alertsCreated } = await this.check.run();
      // Counts only: never an account, a balance or a phone.
      this.logger.log(
        `Balance check: ${accountsChecked} accounts checked, ${alertsCreated} alerts created`,
      );
    } catch (error) {
      // The message only (a database error, no ledger data); the next night
      // runs again.
      const message = error instanceof Error ? error.message : 'unknown error';
      this.logger.error(`Balance check failed: ${message}`);
    }
  }
}
