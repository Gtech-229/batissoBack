import { Module } from '@nestjs/common';
import { ConsolePushSender } from './console-push-sender.js';
import { PUSH_SENDER } from './push-sender.js';

/** Provides `PUSH_SENDER`. E2E tests override it with a fake that keeps the messages. */
@Module({
  providers: [{ provide: PUSH_SENDER, useClass: ConsolePushSender }],
  exports: [PUSH_SENDER],
})
export class PushModule {}
