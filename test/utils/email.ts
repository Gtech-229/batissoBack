import type {
  EmailMessage,
  EmailSender,
} from '../../src/email/email-sender.js';

/** Keeps every email instead of sending it, so a test can follow the links. */
export class CapturingEmailSender implements EmailSender {
  messages: EmailMessage[] = [];

  send(message: EmailMessage): Promise<void> {
    this.messages.push(message);
    return Promise.resolve();
  }

  /** The emails sent to `to`, oldest first. */
  sentTo(to: string): EmailMessage[] {
    return this.messages.filter((m) => m.to === to);
  }

  /** The password link of the last email sent to `to`. */
  lastLinkFor(to: string): URL {
    const link = this.sentTo(to)
      .at(-1)
      ?.text.match(/https?:\/\/\S+/)?.[0];
    if (!link) {
      throw new Error(`No link was sent to ${to}`);
    }
    return new URL(link);
  }

  clear(): void {
    this.messages = [];
  }
}
