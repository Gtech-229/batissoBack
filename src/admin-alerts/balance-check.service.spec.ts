import { Prisma } from '../generated/prisma/client.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import {
  BALANCE_CHECK_TRANSACTION,
  BalanceCheckService,
} from './balance-check.service.js';

describe('BalanceCheckService', () => {
  it('reads in one REPEATABLE READ transaction with a 60 s timeout (F-59)', async () => {
    const queryRaw = vi
      .fn()
      .mockResolvedValueOnce([{ count: 3n }])
      .mockResolvedValue([]);
    const transaction = vi.fn(
      (run: (tx: unknown) => Promise<unknown>, _options: unknown) =>
        run({ $queryRaw: queryRaw }),
    );
    const createMany = vi.fn();
    const service = new BalanceCheckService({
      $transaction: transaction,
      adminAlert: { createMany },
    } as unknown as PrismaService);

    const result = await service.run();

    expect(result).toEqual({ accountsChecked: 3, alertsCreated: 0 });
    expect(transaction).toHaveBeenCalledTimes(1);
    expect(transaction.mock.calls[0][1]).toBe(BALANCE_CHECK_TRANSACTION);
    expect(BALANCE_CHECK_TRANSACTION).toEqual({
      isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
      timeout: 60_000,
    });
    // No gap: nothing written.
    expect(createMany).not.toHaveBeenCalled();
  });
});
