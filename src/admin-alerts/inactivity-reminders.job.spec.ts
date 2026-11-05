import { Logger } from '@nestjs/common';
import { InactivityRemindersJob } from './inactivity-reminders.job.js';
import type { InactivityRemindersService } from './inactivity-reminders.service.js';

function jobWith(remindQuietAccounts: () => Promise<unknown>) {
  return new InactivityRemindersJob({
    remindQuietAccounts,
  } as unknown as InactivityRemindersService);
}

describe('InactivityRemindersJob', () => {
  let log: ReturnType<typeof vi.spyOn>;
  let error: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    log = vi.spyOn(Logger.prototype, 'log').mockImplementation(() => {});
    error = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('logs one summary line with the count only', async () => {
    await jobWith(() => Promise.resolve({ accountsReminded: 4 })).handle();

    expect(log).toHaveBeenCalledWith(
      'Inactivity reminders: 4 accounts reminded',
    );
    expect(error).not.toHaveBeenCalled();
  });

  it('logs a failure with its message and does not throw, so the next day runs', async () => {
    await expect(
      jobWith(() => Promise.reject(new Error('db down'))).handle(),
    ).resolves.toBeUndefined();

    expect(error).toHaveBeenCalledWith('Inactivity reminders failed: db down');
    expect(log).not.toHaveBeenCalled();
  });
});
