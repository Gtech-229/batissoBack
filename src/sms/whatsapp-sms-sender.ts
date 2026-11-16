import type { WhatsappSettingsService } from '../whatsapp-settings/whatsapp-settings.service.js';
import type { GreenApiSend } from './green-api-client.js';
import type { SmsSender } from './sms-sender.js';

/**
 * The SMS interface's sender (25c): every message (sign-in and sign-up codes,
 * purchase codes, SMS notifications) goes over WhatsApp through Green API when
 * the super admin turned it on with a readable token; otherwise it goes the
 * old way (`fallback`, the console sender: a log in development, a failure in
 * production). A Green API failure reaches the caller as it is: it is never
 * turned into a console "send".
 */
export class WhatsappSmsSender implements SmsSender {
  constructor(
    private readonly settings: Pick<
      WhatsappSettingsService,
      'deliveryCredentials'
    >,
    private readonly fallback: SmsSender,
    private readonly sendWhatsapp: GreenApiSend,
  ) {}

  async send(phone: string, text: string): Promise<void> {
    const credentials = await this.settings.deliveryCredentials();
    if (!credentials) {
      return this.fallback.send(phone, text);
    }
    return this.sendWhatsapp(credentials, phone, text);
  }
}
