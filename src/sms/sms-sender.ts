/**
 * Sends a text message. The only implementation in V1 is the console fake; a
 * real provider will implement this same interface.
 *
 * Before using a paid provider (F-53): since 21a, sign-in codes go to any
 * number of the active country, limited per phone only (1 a minute, 5 an hour,
 * 10 a day), so one client could make the platform pay for SMS across a whole
 * number range. Add a global or per-IP limit, or the provider's fraud
 * controls, first.
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
