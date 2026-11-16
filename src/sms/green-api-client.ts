/** Every send waits at most this long for Green API. */
export const GREEN_API_TIMEOUT_MS = 10_000;

/**
 * A failed WhatsApp send (25c). Its message holds only the cause, never the
 * URL (it contains the token), the token, the phone or the text; callers log
 * and store only the error name.
 */
export class WhatsappSendError extends Error {
  override readonly name = 'WhatsappSendError';

  constructor(readonly reason: string) {
    super(`Green API send failed (${reason})`);
  }
}

export interface GreenApiCredentials {
  /** Green API idInstance: digits only (validated when saved, 25b). */
  instanceId: string;
  /** Green API apiTokenInstance, decrypted. */
  token: string;
}

export type FetchFunction = typeof fetch;

/**
 * Sends one WhatsApp text through Green API. The host comes from the
 * instance id (`<first 4 digits>.api.greenapi.com`, Green API's pattern), so
 * it is digits only and cannot point elsewhere. `phone` is in E.164.
 */
export async function sendGreenApiMessage(
  credentials: GreenApiCredentials,
  phone: string,
  text: string,
  fetchFn: FetchFunction = fetch,
): Promise<void> {
  const { instanceId, token } = credentials;
  const url = `https://${instanceId.slice(0, 4)}.api.greenapi.com/waInstance${instanceId}/sendMessage/${token}`;
  let response: Response;
  try {
    response = await fetchFn(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chatId: `${phone.replace(/^\+/, '')}@c.us`,
        message: text,
      }),
      signal: AbortSignal.timeout(GREEN_API_TIMEOUT_MS),
      // Never follow a redirect: it would resend the number and the text to
      // another address. A redirect is a failure like any other.
      redirect: 'error',
    });
  } catch (error) {
    // The fetch error may name the URL: keep only the kind.
    const timedOut =
      error instanceof Error &&
      (error.name === 'TimeoutError' || error.name === 'AbortError');
    throw new WhatsappSendError(timedOut ? 'timeout' : 'network');
  }
  if (!response.ok) {
    throw new WhatsappSendError(`HTTP ${response.status}`);
  }
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new WhatsappSendError('bad response');
  }
  const idMessage = (body as { idMessage?: unknown } | null)?.idMessage;
  if (typeof idMessage !== 'string' || idMessage === '') {
    throw new WhatsappSendError('bad response');
  }
}

/** The send function as Nest injects it; the e2e tests replace it with a fake. */
export type GreenApiSend = (
  credentials: GreenApiCredentials,
  phone: string,
  text: string,
) => Promise<void>;

/** Injection token: `@Inject(GREEN_API_SEND) send: GreenApiSend`. */
export const GREEN_API_SEND = Symbol('GREEN_API_SEND');

/**
 * A failed send as the logs and `lastError` show it: the error's name, plus
 * the Green API cause (`WhatsappSendError (HTTP 466)`), which holds no secret.
 * Never an error's message, which could hold the number or the text.
 */
export function sendFailureKind(error: unknown): string {
  if (error instanceof WhatsappSendError) {
    return `${error.name} (${error.reason})`;
  }
  return error instanceof Error ? error.name : 'unknown error';
}
