import { Module } from '@nestjs/common';
import { WhatsappSettingsModule } from '../whatsapp-settings/whatsapp-settings.module.js';
import { WhatsappSettingsService } from '../whatsapp-settings/whatsapp-settings.service.js';
import { ConsoleSmsSender } from './console-sms-sender.js';
import { GREEN_API_SEND, type GreenApiSend } from './green-api-client.js';
import { SMS_SENDER } from './sms-sender.js';
import { WhatsappSmsSender } from './whatsapp-sms-sender.js';

/**
 * Provides `SMS_SENDER`: WhatsApp through Green API when the super admin
 * turned it on (25c), the console sender otherwise. E2E tests override it with
 * a fake that keeps the messages.
 */
@Module({
  imports: [WhatsappSettingsModule],
  providers: [
    ConsoleSmsSender,
    {
      provide: SMS_SENDER,
      inject: [WhatsappSettingsService, ConsoleSmsSender, GREEN_API_SEND],
      useFactory: (
        settings: WhatsappSettingsService,
        fallback: ConsoleSmsSender,
        send: GreenApiSend,
      ) => new WhatsappSmsSender(settings, fallback, send),
    },
  ],
  exports: [SMS_SENDER],
})
export class SmsModule {}
