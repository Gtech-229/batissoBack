import { Logger } from '@nestjs/common';
import { DeliveryAlertsJob } from './delivery-alerts.job.js';
import type { DeliveryAlertsService } from './delivery-alerts.service.js';

function jobWith(service: Partial<DeliveryAlertsService>) {
  return new DeliveryAlertsJob(service as DeliveryAlertsService);
}

describe('DeliveryAlertsJob', () => {
  let log: ReturnType<typeof vi.spyOn>;
  let error: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    log = vi.spyOn(Logger.prototype, 'log').mockImplementation(() => {});
    error = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('runs both parts with one time and logs one summary line of counts', async () => {
    const overdue = vi.fn().mockResolvedValue({ ordersAlerted: 2 });
    const escalate = vi.fn().mockResolvedValue({ requestsEscalated: 1 });

    await jobWith({
      alertOverdueDeliveries: overdue,
      escalateUnansweredCancellations: escalate,
    }).handle();

    expect(overdue).toHaveBeenCalledTimes(1);
    expect(escalate).toHaveBeenCalledWith(overdue.mock.calls[0][0]);
    expect(log).toHaveBeenCalledWith(
      'Delivery alerts: 2 orders alerted, 1 cancellation requests escalated',
    );
    expect(error).not.toHaveBeenCalled();
  });

  it('logs a failure with its message and does not throw, so the next hour runs', async () => {
    await expect(
      jobWith({
        alertOverdueDeliveries: () => Promise.reject(new Error('db down')),
        escalateUnansweredCancellations: vi.fn(),
      }).handle(),
    ).resolves.toBeUndefined();

    expect(error).toHaveBeenCalledWith('Delivery alerts failed: db down');
    expect(log).not.toHaveBeenCalled();
  });
});
