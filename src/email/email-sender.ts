/** One plain-text email. */
export interface EmailMessage {
  to: string;
  /** French, one line. */
  subject: string;
  /** The full French body, plain text. */
  text: string;
}

/**
 * Sends an email. The only implementation in V1 is the console fake; a real
 * provider will implement this same interface. Only admins receive email.
 */
export interface EmailSender {
  send(message: EmailMessage): Promise<void>;
}

/** Injection token: `@Inject(EMAIL_SENDER) email: EmailSender`. */
export const EMAIL_SENDER = Symbol('EMAIL_SENDER');
