import { Logger } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { EnvironmentVariables } from '../config/env.validation.js';
import { ConsoleEmailSender } from './console-email-sender.js';

const MESSAGE = {
  to: 'awa@batisso.test',
  subject: 'Bâtisso : réinitialisez votre mot de passe',
  text: 'Ouvrez ce lien : http://localhost:5173/password?mode=reset&token=s3cr3t-t0ken',
};

function senderFor(nodeEnv: string) {
  const config = { get: vi.fn().mockReturnValue(nodeEnv) };
  return new ConsoleEmailSender(
    config as unknown as ConfigService<EnvironmentVariables, true>,
  );
}

describe('ConsoleEmailSender', () => {
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
    'logs the address, the subject and the body in %s',
    async (nodeEnv) => {
      await senderFor(nodeEnv).send(MESSAGE);

      expect(log).toHaveBeenCalledWith(
        `To ${MESSAGE.to}: ${MESSAGE.subject}\n${MESSAGE.text}`,
      );
      expect(warn).not.toHaveBeenCalled();
    },
  );

  it('never logs the address, the subject or the body in production, only a warning', async () => {
    await senderFor('production').send(MESSAGE);

    expect(log).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledTimes(1);
    const logged = JSON.stringify(warn.mock.calls);
    expect(logged).not.toContain('s3cr3t-t0ken');
    expect(logged).not.toContain(MESSAGE.to);
    expect(logged).not.toContain('réinitialisez');
  });
});
