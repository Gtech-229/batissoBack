import { Logger } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { EnvironmentVariables } from '../config/env.validation.js';
import { NoProviderConfiguredError } from '../common/errors/no-provider-configured.error.js';
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

  it('fails in production after a warning without the text or the phone (F-01)', async () => {
    const error: unknown = await senderFor('production')
      .send('+22376000000', TEXT)
      .catch((failure: unknown) => failure);

    expect(error).toBeInstanceOf(NoProviderConfiguredError);
    // The kind the send log keeps in lastError.
    expect(error).toHaveProperty('name', 'NoProviderConfiguredError');

    expect(log).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledTimes(1);
    const logged = JSON.stringify(warn.mock.calls);
    expect(logged).not.toContain('482915');
    expect(logged).not.toContain('+22376000000');
  });
});
