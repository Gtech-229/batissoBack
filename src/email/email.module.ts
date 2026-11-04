import { Module } from '@nestjs/common';
import { ConsoleEmailSender } from './console-email-sender.js';
import { EMAIL_SENDER } from './email-sender.js';

/** Provides `EMAIL_SENDER`. E2E tests override it with a fake that keeps the emails. */
@Module({
  providers: [{ provide: EMAIL_SENDER, useClass: ConsoleEmailSender }],
  exports: [EMAIL_SENDER],
})
export class EmailModule {}
