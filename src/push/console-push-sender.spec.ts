import { Logger } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { EnvironmentVariables } from '../config/env.validation.js';
import { ConsolePushSender } from './console-push-sender.js';

const TOKEN = 'fcm-token-of-the-phone-0123456789';
const MESSAGE = { title: 'Dépôt reçu', body: 'Dépôt de 5 000 XOF reçu.' };

function senderFor(nodeEnv: string) {
  const config = { get: vi.fn().mockReturnValue(nodeEnv) };
  return new ConsolePushSender(
    config as unknown as ConfigService<EnvironmentVariables, true>,
  );
}

describe('ConsolePushSender', () => {
  let log: ReturnType<typeof vi.spyOn>;
  let warn: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    log = vi.spyOn(Logger.prototype, 'log').mockImplementation(() => {});
    warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it.each(['development', 'test'])(
    'logs the title and the body in %s, never the token',
    async (nodeEnv) => {
      await senderFor(nodeEnv).send(TOKEN, MESSAGE);

      expect(log).toHaveBeenCalledWith('Dépôt reçu: Dépôt de 5 000 XOF reçu.');
      expect(JSON.stringify(log.mock.calls)).not.toContain(TOKEN);
      expect(warn).not.toHaveBeenCalled();
    },
  );

  it('only warns in production, with neither the message nor the token', async () => {
    await senderFor('production').send(TOKEN, MESSAGE);

    expect(log).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledTimes(1);
    const logged = JSON.stringify(warn.mock.calls);
    expect(logged).not.toContain(TOKEN);
    expect(logged).not.toContain('5 000');
  });
});
