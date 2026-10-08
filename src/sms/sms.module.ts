import { Module } from '@nestjs/common';
import { ConsoleSmsSender } from './console-sms-sender.js';
import { SMS_SENDER } from './sms-sender.js';

/** Provides `SMS_SENDER`. E2E tests override it with a fake that keeps the messages. */
@Module({
  providers: [{ provide: SMS_SENDER, useClass: ConsoleSmsSender }],
  exports: [SMS_SENDER],
})
export class SmsModule {}
