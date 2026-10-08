import type { SmsSender } from '../../src/sms/sms-sender.js';

/**
 * Keeps every SMS instead of sending it, so a test can read the codes. `mode`
 * simulates a provider that fails (`reject`) or never answers (`hang`).
 */
export class CapturingSmsSender implements SmsSender {
  messages: { phone: string; text: string }[] = [];
  mode: 'deliver' | 'reject' | 'hang' = 'deliver';

  send(phone: string, text: string): Promise<void> {
    this.messages.push({ phone, text });
    switch (this.mode) {
      case 'reject':
        return Promise.reject(new Error('Provider unavailable'));
      case 'hang':
        return new Promise<void>(() => {});
      default:
        return Promise.resolve();
    }
  }

  /** The 6-digit code of the last SMS sent to `phone`. */
  lastCodeFor(phone: string): string {
    const message = this.messages.filter((m) => m.phone === phone).at(-1);
    const code = message?.text.match(/\b(\d{6})\b/)?.[1];
    if (!code) {
      throw new Error(`No code was sent to ${phone}`);
    }
    return code;
  }

  /** Forgets the messages and goes back to delivering normally. */
  clear(): void {
    this.messages = [];
    this.mode = 'deliver';
  }
}
