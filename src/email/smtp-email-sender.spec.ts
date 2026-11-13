import type { ConfigService } from '@nestjs/config';
import type { EnvironmentVariables } from '../config/env.validation.js';
import { ConsoleEmailSender } from './console-email-sender.js';
import { emailSenderFor } from './email.module.js';
import { SmtpEmailSender, smtpOptions } from './smtp-email-sender.js';

const SMTP_PASSWORD = 'smtp-pa55word-value';
const SETTINGS: Record<string, unknown> = {
  NODE_ENV: 'production',
  SMTP_HOST: 'mail.ikaso-mali.com',
  SMTP_PORT: 465,
  SMTP_USER: 'alerte@ikaso-mali.com',
  SMTP_PASSWORD,
  EMAIL_FROM: 'Ikasso <alerte@ikaso-mali.com>',
};
const MESSAGE = {
  to: 'awa@batisso.test',
  subject: 'Bâtisso : réinitialisez votre mot de passe',
  text: 'Ouvrez ce lien : https://admin.example/password?mode=reset&token=s3cr3t-t0ken',
};

function configWith(values: Record<string, unknown>) {
  return {
    get: vi.fn((name: string) => values[name]),
  } as unknown as ConfigService<EnvironmentVariables, true>;
}

describe('SmtpEmailSender', () => {
  const sendMail = vi.fn();
  const makeTransport = vi.fn(() => ({ sendMail }));
  const sender = () => new SmtpEmailSender(configWith(SETTINGS), makeTransport);

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('transport options', () => {
    it('speaks TLS from the first byte on 465, certificate verified', () => {
      sender();

      expect(makeTransport).toHaveBeenCalledWith({
        host: 'mail.ikaso-mali.com',
        port: 465,
        secure: true,
        requireTLS: false,
        auth: { user: 'alerte@ikaso-mali.com', pass: SMTP_PASSWORD },
        tls: { rejectUnauthorized: true, minVersion: 'TLSv1.2' },
        connectionTimeout: 10_000,
        greetingTimeout: 10_000,
        socketTimeout: 30_000,
      });
    });

    it('requires STARTTLS on any other port, never clear text', () => {
      const options = smtpOptions('mail.ikaso-mali.com', 587, {
        user: 'u',
        pass: 'p',
      });

      expect(options.secure).toBe(false);
      expect(options.requireTLS).toBe(true);
      expect(options.tls?.rejectUnauthorized).toBe(true);
    });
  });

  it('sends the message from EMAIL_FROM, as plain text', async () => {
    sendMail.mockResolvedValue({ messageId: 'id' });

    await sender().send(MESSAGE);

    expect(sendMail).toHaveBeenCalledWith({
      from: 'Ikasso <alerte@ikaso-mali.com>',
      to: MESSAGE.to,
      subject: MESSAGE.subject,
      text: MESSAGE.text,
    });
  });

  it.each([
    [
      'a rejected login',
      Object.assign(
        new Error(
          `Invalid login: 535 Authentication failed for alerte@ikaso-mali.com ${SMTP_PASSWORD}`,
        ),
        { code: 'EAUTH', responseCode: 535 },
      ),
      'SMTP send failed (EAUTH 535)',
    ],
    [
      'a rejected recipient',
      Object.assign(
        new Error(
          `Can't send mail - all recipients were rejected: 550 <${MESSAGE.to}> ${MESSAGE.text}`,
        ),
        { code: 'EENVELOPE', responseCode: 550 },
      ),
      'SMTP send failed (EENVELOPE 550)',
    ],
    [
      'a connection failure',
      Object.assign(new Error('connect ETIMEDOUT 83.229.19.96:465'), {
        code: 'ETIMEDOUT',
      }),
      'SMTP send failed (ETIMEDOUT)',
    ],
    ['an odd value', 'boom', 'SMTP send failed (unknown)'],
    [
      'an odd code',
      Object.assign(new Error('x'), { code: MESSAGE.to, responseCode: '535' }),
      'SMTP send failed (unknown)',
    ],
  ])(
    'rejects %s with the codes only, no address, body, link or credentials',
    async (_label, failure, expected) => {
      sendMail.mockRejectedValue(failure);

      const error = await sender()
        .send(MESSAGE)
        .then(
          () => undefined,
          (rejected: unknown) => rejected as Error,
        );

      expect(error?.message).toBe(expected);
      for (const secret of [
        MESSAGE.to,
        'token',
        'alerte@ikaso-mali.com',
        SMTP_PASSWORD,
      ]) {
        expect(error?.message).not.toContain(secret);
      }
    },
  );
});

// Building a nodemailer transport opens no connection: nothing is sent here.
describe('emailSenderFor (EmailModule)', () => {
  it('picks SMTP when the SMTP settings are present', () => {
    expect(emailSenderFor(configWith(SETTINGS))).toBeInstanceOf(
      SmtpEmailSender,
    );
  });

  it('keeps the console fake when the SMTP lines are present but empty (F-87)', () => {
    // ConfigService falls back to process.env, where SMTP_HOST= reads as ''.
    const sender = emailSenderFor(
      configWith({
        NODE_ENV: 'development',
        SMTP_HOST: '',
        SMTP_PORT: '',
        SMTP_USER: '',
        SMTP_PASSWORD: '',
        EMAIL_FROM: '',
      }),
    );

    expect(sender).toBeInstanceOf(ConsoleEmailSender);
  });

  it('keeps the console fake otherwise', () => {
    const sender = emailSenderFor(configWith({ NODE_ENV: 'production' }));

    expect(sender).toBeInstanceOf(ConsoleEmailSender);
  });
});
