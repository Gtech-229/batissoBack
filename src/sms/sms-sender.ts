/**
 * Sends a text message. The only implementation in V1 is the console fake; a
 * real provider will implement this same interface.
 */
export interface SmsSender {
  /** `phone` is in E.164; `text` is the full French message. */
  send(phone: string, text: string): Promise<void>;
}

/**
 * Injection token: an interface does not exist at runtime, so Nest needs a value
 * to look the provider up: `@Inject(SMS_SENDER) sms: SmsSender`.
 */
export const SMS_SENDER = Symbol('SMS_SENDER');
