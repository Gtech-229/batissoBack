import { Logger } from '@nestjs/common';
import type { PrismaService } from '../prisma/prisma.service.js';
import type { PushSender } from '../push/push-sender.js';
import type { SmsSender } from '../sms/sms-sender.js';
import { NotificationsService } from './notifications.service.js';

const PHONE = '+22376445566';
const TOKEN = 'token-of-the-phone';

const row = (channel: 'SMS' | 'PUSH', pushToken: string | null = TOKEN) => ({
  id: `n-${channel}`,
  channel,
  status: 'PENDING',
  title: 'Dépôt reçu',
  body: 'Dépôt de 5 000 XOF reçu.',
  user: { phone: PHONE },
  device: channel === 'PUSH' ? { pushToken } : null,
});

describe('NotificationsService.dispatch', () => {
  let findUnique: ReturnType<typeof vi.fn>;
  let update: ReturnType<typeof vi.fn>;
  let sms: { send: ReturnType<typeof vi.fn> };
  let push: { send: ReturnType<typeof vi.fn> };
  let service: NotificationsService;
  let logged: string[];

  beforeEach(() => {
    findUnique = vi.fn();
    update = vi.fn().mockResolvedValue({});
    sms = { send: vi.fn().mockResolvedValue(undefined) };
    push = { send: vi.fn().mockResolvedValue(undefined) };
    logged = [];
    for (const level of ['warn', 'error'] as const) {
      vi.spyOn(Logger.prototype, level).mockImplementation((message) => {
        logged.push(String(message));
      });
    }
    service = new NotificationsService(
      { notification: { findUnique, update } } as unknown as PrismaService,
      sms as unknown as SmsSender,
      push as unknown as PushSender,
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const statusOf = () =>
    (update.mock.calls[0] as [{ data: { status: string } }])[0].data;

  it('sends an SMS to the user’s phone and marks it SENT', async () => {
    findUnique.mockResolvedValue(row('SMS'));

    await service.dispatch(['n-SMS']);

    expect(sms.send).toHaveBeenCalledWith(PHONE, 'Dépôt de 5 000 XOF reçu.');
    expect(statusOf()).toMatchObject({ status: 'SENT', lastError: null });
  });

  it('fails a push whose device lost its token since the row was written', async () => {
    findUnique.mockResolvedValue(row('PUSH', null));

    await service.dispatch(['n-PUSH']);

    expect(push.send).not.toHaveBeenCalled();
    expect(statusOf()).toMatchObject({
      status: 'FAILED',
      lastError: 'NoPushToken',
    });
  });

  it('skips a row that is no longer PENDING (already sent by another run)', async () => {
    findUnique.mockResolvedValue({ ...row('SMS'), status: 'SENT' });

    await service.dispatch(['n-SMS']);

    expect(sms.send).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });

  it('never throws, even when the database fails, and logs the id only', async () => {
    findUnique
      .mockRejectedValueOnce(new Error(`connection lost, phone ${PHONE}`))
      .mockResolvedValueOnce(row('PUSH'));

    await expect(service.dispatch(['n-1', 'n-PUSH'])).resolves.toBeUndefined();

    // The next row is still sent.
    expect(push.send).toHaveBeenCalledTimes(1);
    expect(logged).toEqual([
      'Notification n-1 could not be dispatched (Error)',
    ]);
  });

  it('keeps the phone, the token, and the text out of a failure log', async () => {
    findUnique.mockResolvedValue(row('PUSH'));
    push.send.mockRejectedValue(
      Object.assign(new Error(`bad token ${TOKEN} for ${PHONE}`), {
        name: 'InvalidToken',
      }),
    );

    await service.dispatch(['n-PUSH']);

    expect(statusOf()).toMatchObject({
      status: 'FAILED',
      lastError: 'InvalidToken',
    });
    const all = logged.join(' ');
    expect(all).not.toContain(TOKEN);
    expect(all).not.toContain(PHONE);
    expect(all).not.toContain('5 000');
  });
});
