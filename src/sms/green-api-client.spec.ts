import {
  GREEN_API_TIMEOUT_MS,
  sendFailureKind,
  sendGreenApiMessage,
  WhatsappSendError,
  type FetchFunction,
} from './green-api-client.js';

const CREDENTIALS = {
  instanceId: '7103123456',
  token: 'd75b3a66374942c5b3c019c698abc2067e151558acbd412345',
};
const PHONE = '+22376000000';
const TEXT = 'Bâtisso : votre code est 123456';

function fakeFetch(
  respond: () => Promise<Response>,
): FetchFunction & ReturnType<typeof vi.fn> {
  return vi.fn(respond) as unknown as FetchFunction & ReturnType<typeof vi.fn>;
}

const json = (status: number, body: unknown) =>
  Promise.resolve(
    new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    }),
  );

/** The rejection, to check its message never carries a secret. */
async function failure(fetchFn: FetchFunction): Promise<WhatsappSendError> {
  const error = await sendGreenApiMessage(CREDENTIALS, PHONE, TEXT, fetchFn)
    .then(() => undefined)
    .catch((rejected: unknown) => rejected);
  expect(error).toBeInstanceOf(WhatsappSendError);
  const sendError = error as WhatsappSendError;
  for (const secret of [
    CREDENTIALS.token,
    'api.greenapi.com',
    'waInstance',
    PHONE,
    '22376000000',
    TEXT,
    '123456',
  ]) {
    expect(sendError.message).not.toContain(secret);
  }
  return sendError;
}

describe('sendGreenApiMessage', () => {
  it('posts the text to the instance host, chatId without +', async () => {
    const fetchFn = fakeFetch(() =>
      json(200, { idMessage: 'BAE5F4886F6F2D05' }),
    );

    await sendGreenApiMessage(CREDENTIALS, PHONE, TEXT, fetchFn);

    expect(fetchFn).toHaveBeenCalledTimes(1);
    const [url, init] = fetchFn.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(
      `https://7103.api.greenapi.com/waInstance7103123456/sendMessage/${CREDENTIALS.token}`,
    );
    expect(init.method).toBe('POST');
    expect(init.headers).toEqual({ 'Content-Type': 'application/json' });
    expect(JSON.parse(init.body as string)).toEqual({
      chatId: '22376000000@c.us',
      message: TEXT,
    });
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it.each([401, 403, 429, 466, 500])(
    'rejects HTTP %i with the status only',
    async (status) => {
      const error = await failure(
        fakeFetch(() =>
          json(status, { message: `token ${CREDENTIALS.token}` }),
        ),
      );

      expect(error.message).toBe(`Green API send failed (HTTP ${status})`);
      expect(error.reason).toBe(`HTTP ${status}`);
      expect(error.name).toBe('WhatsappSendError');
    },
  );

  it('rejects a timeout', async () => {
    const error = await failure(
      fakeFetch(() =>
        Promise.reject(
          new DOMException(
            'The operation was aborted due to timeout',
            'TimeoutError',
          ),
        ),
      ),
    );

    expect(error.reason).toBe('timeout');
  });

  it('rejects a network error, whose message names the URL, as "network"', async () => {
    const error = await failure(
      fakeFetch(() =>
        Promise.reject(
          new TypeError(
            `fetch failed: https://7103.api.greenapi.com/waInstance7103123456/sendMessage/${CREDENTIALS.token}`,
          ),
        ),
      ),
    );

    expect(error.reason).toBe('network');
  });

  it.each([
    ['a 200 without idMessage', () => json(200, { ok: true })],
    ['a 200 with an empty idMessage', () => json(200, { idMessage: '' })],
    ['a 200 with null', () => json(200, null)],
    [
      'a 200 that is not JSON',
      () => Promise.resolve(new Response('<html>oops</html>', { status: 200 })),
    ],
  ])('rejects %s as a bad response', async (_label, respond) => {
    const error = await failure(fakeFetch(respond));

    expect(error.reason).toBe('bad response');
  });
});

describe('sendGreenApiMessage limits (F-98, redirects)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('waits 10 seconds at most', async () => {
    const timeout = vi.spyOn(AbortSignal, 'timeout');
    const fetchFn = fakeFetch(() => json(200, { idMessage: 'id' }));

    await sendGreenApiMessage(CREDENTIALS, PHONE, TEXT, fetchFn);

    expect(GREEN_API_TIMEOUT_MS).toBe(10_000);
    expect(timeout).toHaveBeenCalledWith(10_000);
    const [, init] = fetchFn.mock.calls[0] as [string, RequestInit];
    expect(init.signal).toBe(timeout.mock.results[0].value);
  });

  it('refuses to follow a redirect', async () => {
    const fetchFn = fakeFetch(() => json(200, { idMessage: 'id' }));

    await sendGreenApiMessage(CREDENTIALS, PHONE, TEXT, fetchFn);

    const [, init] = fetchFn.mock.calls[0] as [string, RequestInit];
    expect(init.redirect).toBe('error');
  });

  it('counts a redirect, which fetch rejects, as a network failure', async () => {
    const error = await failure(
      fakeFetch(() =>
        Promise.reject(new TypeError('fetch failed: unexpected redirect')),
      ),
    );

    expect(error.reason).toBe('network');
  });
});

describe('sendFailureKind (F-97)', () => {
  it('gives the Green API cause, which holds no secret', () => {
    expect(sendFailureKind(new WhatsappSendError('HTTP 466'))).toBe(
      'WhatsappSendError (HTTP 466)',
    );
  });

  it('gives only the name of any other error, never its message', () => {
    const error = new Error(`Bâtisso : votre code est 123456 for ${PHONE}`);
    error.name = 'NoProviderConfiguredError';

    expect(sendFailureKind(error)).toBe('NoProviderConfiguredError');
  });

  it('describes a non-error value without its content', () => {
    expect(sendFailureKind(`${CREDENTIALS.token}`)).toBe('unknown error');
  });
});
