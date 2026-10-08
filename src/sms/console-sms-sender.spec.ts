import { Logger } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { EnvironmentVariables } from '../config/env.validation.js';
import { ConsoleSmsSender } from './console-sms-sender.js';

const TEXT = 'Bâtisso : votre code de connexion est 482915.';

function senderFor(nodeEnv: string) {
  const config = { get: vi.fn().mockReturnValue(nodeEnv) };
  return new ConsoleSmsSender(
    config as unknown as ConfigService<EnvironmentVariables, true>,
  );
}

describe('ConsoleSmsSender', () => {
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
    'logs the phone and the text in %s',
    async (nodeEnv) => {
      await senderFor(nodeEnv).send('+22376000000', TEXT);

      expect(log).toHaveBeenCalledWith(`To +22376000000: ${TEXT}`);
      expect(warn).not.toHaveBeenCalled();
    },
  );

  it('never logs the text or the phone in production, only a warning', async () => {
    await senderFor('production').send('+22376000000', TEXT);

    expect(log).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledTimes(1);
    const logged = JSON.stringify(warn.mock.calls);
    expect(logged).not.toContain('482915');
    expect(logged).not.toContain('+22376000000');
  });
});
