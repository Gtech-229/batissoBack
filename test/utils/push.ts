import type { PushMessage, PushSender } from '../../src/push/push-sender.js';

/**
 * Keeps every push instead of sending it. `mode` simulates a provider that
 * fails (`reject`) or never answers (`hang`).
 */
export class CapturingPushSender implements PushSender {
  messages: ({ token: string } & PushMessage)[] = [];
  mode: 'deliver' | 'reject' | 'hang' = 'deliver';

  send(token: string, message: PushMessage): Promise<void> {
    this.messages.push({ token, ...message });
    switch (this.mode) {
      case 'reject':
        return Promise.reject(new Error('Provider unavailable'));
      case 'hang':
        return new Promise<void>(() => {});
      default:
        return Promise.resolve();
    }
  }

  /** Forgets the messages and goes back to delivering normally. */
  clear(): void {
    this.messages = [];
    this.mode = 'deliver';
  }
}
