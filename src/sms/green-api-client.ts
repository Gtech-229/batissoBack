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
 * Countries whose numbers grew from 8 to 10 digits (a 2-digit prefix before
 * the old 8): Côte d'Ivoire (2021) and Benin (2024). WhatsApp accounts created
 * before the switch keep their old ID (country code + the 8 old digits).
 */
const TEN_DIGIT_SWITCH_CODES = ['225', '229'];

/**
 * Côte d'Ivoire, 2021 (ARTCI plan, F-100): each old mobile number got the one
 * prefix of its operator, from its first 2 digits. Another prefix with the same
 * 8 digits is a different subscriber, so it never falls back to that old ID.
 */
const IVORIAN_OPERATOR_RANGES: Record<string, string[]> = {
  // Moov
  '01': [
    '01',
    '02',
    '03',
    '40',
    '41',
    '42',
    '43',
    '50',
    '51',
    '52',
    '53',
    '70',
    '71',
    '72',
    '73',
  ],
  // MTN
  '05': [
    '04',
    '05',
    '06',
    '44',
    '45',
    '46',
    '54',
    '55',
    '56',
    '64',
    '65',
    '66',
    '74',
    '75',
    '76',
    '84',
    '85',
    '86',
    '94',
    '95',
    '96',
  ],
  // Orange
  '07': [
    '07',
    '08',
    '09',
    '47',
    '48',
    '49',
    '57',
    '58',
    '59',
    '67',
    '68',
    '69',
    '77',
    '78',
    '79',
    '87',
    '88',
    '89',
    '97',
    '98',
  ],
};

/**
 * The pre-switch ID of a 10-digit number (country code + its last 8 digits),
 * or null when that old number cannot be this subscriber's: an Ivorian prefix
 * that is not the one the old number migrated to. Benin added `01` to every
 * number, so its old ID is always the subscriber's.
 */
function preSwitchNumber(code: string, national: string): string | null {
  const [prefix, old] = [national.slice(0, 2), national.slice(2)];
  if (
    code === '225' &&
    !IVORIAN_OPERATOR_RANGES[prefix]?.includes(old.slice(0, 2))
  ) {
    return null;
  }
  return code + old;
}

/**
 * Sends one WhatsApp text through Green API. The host comes from the
 * instance id (`<first 4 digits>.api.greenapi.com`, Green API's pattern), so
 * it is digits only and cannot point elsewhere. `phone` is in E.164.
 *
 * An Ivorian or Beninese 10-digit number is first checked (`checkWhatsapp`):
 * the new ID, then the pre-switch one when it is the same subscriber's; the
 * text goes to the first that has an account, and nowhere when none has one. One deadline covers every call.
 */
export async function sendGreenApiMessage(
  credentials: GreenApiCredentials,
  phone: string,
  text: string,
  fetchFn: FetchFunction = fetch,
): Promise<void> {
  const { instanceId, token } = credentials;
  const base = `https://${instanceId.slice(0, 4)}.api.greenapi.com/waInstance${instanceId}`;
  const signal = AbortSignal.timeout(GREEN_API_TIMEOUT_MS);
  const call = (method: string, payload: object, cause: string) =>
    postGreenApi(`${base}/${method}/${token}`, payload, signal, fetchFn, cause);

  const chatNumber = await whatsappNumber(phone.replace(/^\+/, ''), (number) =>
    call('checkWhatsapp', { phoneNumber: Number(number) }, 'check '),
  );
  const sent = await call(
    'sendMessage',
    { chatId: `${chatNumber}@c.us`, message: text },
    '',
  );
  const idMessage = (sent as { idMessage?: unknown } | null)?.idMessage;
  if (typeof idMessage !== 'string' || idMessage === '') {
    throw new WhatsappSendError('bad response');
  }
}

/**
 * The number WhatsApp knows: unchanged outside the 10-digit switch countries;
 * there, the new form or the pre-switch one, whichever has an account.
 */
async function whatsappNumber(
  digits: string,
  check: (number: string) => Promise<unknown>,
): Promise<string> {
  const code = TEN_DIGIT_SWITCH_CODES.find((c) => digits.startsWith(c));
  if (!code || digits.length !== code.length + 10) {
    return digits;
  }
  const old = preSwitchNumber(code, digits.slice(code.length));
  for (const candidate of old ? [digits, old] : [digits]) {
    const answer = await check(candidate);
    const exists = (answer as { existsWhatsapp?: unknown } | null)
      ?.existsWhatsapp;
    if (typeof exists !== 'boolean') {
      throw new WhatsappSendError('check bad response');
    }
    if (exists) {
      return candidate;
    }
  }
  throw new WhatsappSendError('no WhatsApp account');
}

/**
 * One Green API call: its JSON answer, or a `WhatsappSendError` whose reason
 * (prefixed with `cause`) never holds the URL, the token, the number or the text.
 */
async function postGreenApi(
  url: string,
  payload: object,
  signal: AbortSignal,
  fetchFn: FetchFunction,
  cause: string,
): Promise<unknown> {
  let response: Response;
  try {
    response = await fetchFn(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal,
      // Never follow a redirect: it would resend the number and the text to
      // another address. A redirect is a failure like any other.
      redirect: 'error',
    });
  } catch (error) {
    // The fetch error may name the URL: keep only the kind.
    const timedOut =
      error instanceof Error &&
      (error.name === 'TimeoutError' || error.name === 'AbortError');
    throw new WhatsappSendError(`${cause}${timedOut ? 'timeout' : 'network'}`);
  }
  if (!response.ok) {
    throw new WhatsappSendError(`${cause}HTTP ${response.status}`);
  }
  try {
    return (await response.json()) as unknown;
  } catch {
    throw new WhatsappSendError(`${cause}bad response`);
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
