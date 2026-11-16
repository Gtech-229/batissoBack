import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AdminAuthModule } from '../admin-auth/admin-auth.module.js';
import type { EnvironmentVariables } from '../config/env.validation.js';
import {
  GREEN_API_SEND,
  sendGreenApiMessage,
} from '../sms/green-api-client.js';
import { TokenCipher } from './token-cipher.js';
import { WhatsappSettingsController } from './whatsapp-settings.controller.js';
import { WhatsappSettingsService } from './whatsapp-settings.service.js';

@Module({
  // AdminAuthModule for the password re-confirmation.
  imports: [AdminAuthModule],
  controllers: [WhatsappSettingsController],
  providers: [
    WhatsappSettingsService,
    {
      // The key read once; an empty variable reads as no key. Tests replace it.
      provide: TokenCipher,
      inject: [ConfigService],
      useFactory: (config: ConfigService<EnvironmentVariables, true>) =>
        new TokenCipher(
          config.get('SETTINGS_ENCRYPTION_KEY', { infer: true }) || undefined,
        ),
    },
    // The real Green API call; the e2e tests replace it with a fake.
    {
      provide: GREEN_API_SEND,
      useValue: (...args: Parameters<typeof sendGreenApiMessage>) =>
        sendGreenApiMessage(...args),
    },
  ],
  // For SmsModule's WhatsApp sender (25c).
  exports: [WhatsappSettingsService, GREEN_API_SEND],
})
export class WhatsappSettingsModule {}
