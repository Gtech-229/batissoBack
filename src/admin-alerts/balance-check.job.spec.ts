import { Logger } from '@nestjs/common';
import { BalanceCheckJob } from './balance-check.job.js';
import type { BalanceCheckService } from './balance-check.service.js';

function jobWith(run: () => Promise<unknown>) {
  return new BalanceCheckJob({ run } as unknown as BalanceCheckService);
}

describe('BalanceCheckJob', () => {
  let log: ReturnType<typeof vi.spyOn>;
  let error: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    log = vi.spyOn(Logger.prototype, 'log').mockImplementation(() => {});
    error = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('logs one summary line with the counts only', async () => {
    await jobWith(() =>
      Promise.resolve({ accountsChecked: 42, alertsCreated: 3 }),
    ).handle();

    expect(log).toHaveBeenCalledTimes(1);
    expect(log).toHaveBeenCalledWith(
      'Balance check: 42 accounts checked, 3 alerts created',
    );
    expect(error).not.toHaveBeenCalled();
  });

  it('logs a failure with its message and does not throw, so the next night runs', async () => {
    await expect(
      jobWith(() => Promise.reject(new Error('connection lost'))).handle(),
    ).resolves.toBeUndefined();

    expect(error).toHaveBeenCalledWith('Balance check failed: connection lost');
    expect(log).not.toHaveBeenCalled();
  });
});
