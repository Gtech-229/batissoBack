import type { ConfigService } from '@nestjs/config';
import { createTransport, type Transporter } from 'nodemailer';
import type SMTPTransport from 'nodemailer/lib/smtp-transport/index.js';
import type { EnvironmentVariables } from '../config/env.validation.js';
import type { EmailMessage, EmailSender } from './email-sender.js';

/** Implicit TLS (SMTPS); any other port must upgrade with STARTTLS. */
const IMPLICIT_TLS_PORT = 465;

/**
 * Sends the admins' emails through the configured SMTP server (SMTP_* and
 * EMAIL_FROM, validated together at startup). Never in clear text: port 465
 * speaks TLS from the first byte, any other port must upgrade with STARTTLS,
 * and the server's certificate must be valid for SMTP_HOST.
 * Built by EmailModule's factory; `makeTransport` is the tests' seam.
 */
export class SmtpEmailSender implements EmailSender {
  private readonly transport: Pick<
    Transporter<SMTPTransport.SentMessageInfo>,
    'sendMail'
  >;
  private readonly from: string;

  constructor(
    config: ConfigService<EnvironmentVariables, true>,
    makeTransport: (
      options: SMTPTransport.Options,
    ) => Pick<Transporter<SMTPTransport.SentMessageInfo>, 'sendMail'> = (
      options,
    ) => createTransport(options),
  ) {
    const host = config.get('SMTP_HOST', { infer: true }) as string;
    const port = config.get('SMTP_PORT', { infer: true }) as number;
    this.from = config.get('EMAIL_FROM', { infer: true }) as string;
    this.transport = makeTransport(
      smtpOptions(host, port, {
        user: config.get('SMTP_USER', { infer: true }) as string,
        pass: config.get('SMTP_PASSWORD', { infer: true }) as string,
      }),
    );
  }

  async send(message: EmailMessage): Promise<void> {
    try {
      await this.transport.sendMail({
        from: this.from,
        to: message.to,
        subject: message.subject,
        text: message.text,
      });
    } catch (error) {
      // The caller logs the message: keep only the codes, never the address,
      // the body (a password link) or the credentials.
      throw new Error(sanitizedSendError(error));
    }
  }
}

export function smtpOptions(
  host: string,
  port: number,
  auth: { user: string; pass: string },
): SMTPTransport.Options {
  const implicitTls = port === IMPLICIT_TLS_PORT;
  return {
    host,
    port,
    secure: implicitTls,
    requireTLS: !implicitTls,
    auth,
    // nodemailer sets the TLS server name to `host` itself (and leaves it out
    // for an IP address, which SNI forbids); the certificate is checked
    // against `host` either way.
    tls: { rejectUnauthorized: true, minVersion: 'TLSv1.2' },
    // A dead or slow server must not hold a send forever.
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 30_000,
  };
}

/** `SMTP send failed (EAUTH 535)`: the error code and SMTP reply code only. */
export function sanitizedSendError(error: unknown): string {
  const details = error as { code?: unknown; responseCode?: unknown };
  const code =
    typeof details?.code === 'string' && /^[A-Z_]{1,32}$/.test(details.code)
      ? details.code
      : 'unknown';
  const reply =
    typeof details?.responseCode === 'number' &&
    Number.isInteger(details.responseCode)
      ? ` ${details.responseCode}`
      : '';
  return `SMTP send failed (${code}${reply})`;
}
