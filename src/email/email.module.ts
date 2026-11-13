import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { EnvironmentVariables } from '../config/env.validation.js';
import { ConsoleEmailSender } from './console-email-sender.js';
import { EMAIL_SENDER, type EmailSender } from './email-sender.js';
import { SmtpEmailSender } from './smtp-email-sender.js';

/**
 * SMTP when the SMTP_* settings are present (startup validation guarantees
 * all or none), otherwise the console fake. ConfigService falls back to
 * process.env, where an empty line (`SMTP_HOST=`) still reads as '', so only a
 * non-empty host counts (F-87).
 */
export function emailSenderFor(
  config: ConfigService<EnvironmentVariables, true>,
): EmailSender {
  return config.get('SMTP_HOST', { infer: true })
    ? new SmtpEmailSender(config)
    : new ConsoleEmailSender(config);
}

/** Provides `EMAIL_SENDER`. E2E tests override it with a fake that keeps the emails. */
@Module({
  providers: [
    {
      provide: EMAIL_SENDER,
      inject: [ConfigService],
      useFactory: emailSenderFor,
    },
  ],
  exports: [EMAIL_SENDER],
})
export class EmailModule {}
