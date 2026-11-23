/**
 * Sends a text message. The only implementation in V1 is the console fake; a
 * real provider will implement this same interface.
 *
 * Before using a paid provider (F-53): since 21a, sign-in codes go to any
 * number of every open country (27: several can be active), limited per phone
 * (1 a minute, 5 an hour, 10 a day) and by the platform-wide cap (25a), so one
 * client could still make the platform pay for SMS across whole number ranges. Add a global or per-IP limit, or the provider's fraud
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
