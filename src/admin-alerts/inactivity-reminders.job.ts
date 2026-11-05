import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InactivityRemindersService } from './inactivity-reminders.service.js';

/** The job's name in the SchedulerRegistry. */
export const INACTIVITY_REMINDERS_JOB = 'inactivity-reminders';

/**
 * Sends the inactivity reminders every day at 09:00 UTC (17c): daytime in Mali
 * and Côte d'Ivoire, so no SMS at night. A reminder is at most a day late.
 */
@Injectable()
export class InactivityRemindersJob {
  private readonly logger = new Logger(InactivityRemindersJob.name);

  constructor(private readonly reminders: InactivityRemindersService) {}

  @Cron('0 9 * * *', { name: INACTIVITY_REMINDERS_JOB, timeZone: 'UTC' })
  async handle(): Promise<void> {
    try {
      const { accountsReminded } = await this.reminders.remindQuietAccounts();
      // Counts only: never an account, a phone or a balance.
      this.logger.log(
        `Inactivity reminders: ${accountsReminded} accounts reminded`,
      );
    } catch (error) {
      // The message only; the next day runs again.
      const message = error instanceof Error ? error.message : 'unknown error';
      this.logger.error(`Inactivity reminders failed: ${message}`);
    }
  }
}
