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
const TEXT = 'Ikasso : votre code est 123456';

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
    const error = new Error(`Ikasso : votre code est 123456 for ${PHONE}`);
    error.name = 'NoProviderConfiguredError';

    expect(sendFailureKind(error)).toBe('NoProviderConfiguredError');
  });

  it('describes a non-error value without its content', () => {
    expect(sendFailureKind(`${CREDENTIALS.token}`)).toBe('unknown error');
  });
});

describe('sendGreenApiMessage: Ivorian and Beninese 10-digit numbers', () => {
  const CI_PHONE = '+2250707020304';
  const BJ_PHONE = '+2290154329703';

  /** Answers checkWhatsapp from `accounts`, sendMessage with an id. */
  function greenApi(accounts: string[]) {
    return fakeFetch(() =>
      Promise.reject(new Error('unused')),
    ).mockImplementation((url: string, init: RequestInit) => {
      const body = JSON.parse(init.body as string) as {
        phoneNumber?: number;
      };
      return url.includes('/checkWhatsapp/')
        ? json(200, {
            existsWhatsapp: accounts.includes(String(body.phoneNumber)),
          })
        : json(200, { idMessage: 'BAE5F4886F6F2D05' });
    });
  }

  const calls = (fetchFn: ReturnType<typeof greenApi>) =>
    (fetchFn.mock.calls as [string, RequestInit][]).map(([url, init]) => ({
      method: url.split('/').at(-2),
      body: JSON.parse(init.body as string) as unknown,
      init,
    }));

  async function sendError(fetchFn: FetchFunction, phone = CI_PHONE) {
    const error = await sendGreenApiMessage(CREDENTIALS, phone, TEXT, fetchFn)
      .then(() => undefined)
      .catch((rejected: unknown) => rejected);
    expect(error).toBeInstanceOf(WhatsappSendError);
    const failed = error as WhatsappSendError;
    for (const secret of [
      CREDENTIALS.token,
      'waInstance',
      '0707020304',
      TEXT,
    ]) {
      expect(failed.message).not.toContain(secret);
    }
    return failed;
  }

  it('sends to the new ID when it has an account (one check)', async () => {
    const fetchFn = greenApi(['2250707020304']);

    await sendGreenApiMessage(CREDENTIALS, CI_PHONE, TEXT, fetchFn);

    expect(
      calls(fetchFn).map(({ method, body }) => ({ method, body })),
    ).toEqual([
      { method: 'checkWhatsapp', body: { phoneNumber: 2250707020304 } },
      {
        method: 'sendMessage',
        body: { chatId: '2250707020304@c.us', message: TEXT },
      },
    ]);
    expect(fetchFn.mock.calls[0][0]).toBe(
      `https://7103.api.greenapi.com/waInstance7103123456/checkWhatsapp/${CREDENTIALS.token}`,
    );
  });

  it.each([
    ['Ivorian', CI_PHONE, 22507020304, '22507020304@c.us'],
    ['Beninese', BJ_PHONE, 22954329703, '22954329703@c.us'],
  ])(
    'sends a %s number to its pre-switch ID when only that one exists',
    async (_label, phone, oldNumber, chatId) => {
      const fetchFn = greenApi([String(oldNumber)]);

      await sendGreenApiMessage(CREDENTIALS, phone, TEXT, fetchFn);

      const made = calls(fetchFn);
      expect(made.map(({ method }) => method)).toEqual([
        'checkWhatsapp',
        'checkWhatsapp',
        'sendMessage',
      ]);
      expect(made[1].body).toEqual({ phoneNumber: oldNumber });
      expect(made[2].body).toEqual({ chatId, message: TEXT });
    },
  );

  it('sends nothing when neither ID has an account', async () => {
    const fetchFn = greenApi([]);

    const error = await sendError(fetchFn);

    expect(error.reason).toBe('no WhatsApp account');
    expect(calls(fetchFn).map(({ method }) => method)).toEqual([
      'checkWhatsapp',
      'checkWhatsapp',
    ]);
  });

  it('never checks a Malian number, nor an 8-digit Ivorian one', async () => {
    for (const phone of [PHONE, '+22501020304']) {
      const fetchFn = greenApi([]);

      await sendGreenApiMessage(CREDENTIALS, phone, TEXT, fetchFn);

      expect(calls(fetchFn).map(({ method }) => method)).toEqual([
        'sendMessage',
      ]);
    }
  });

  it.each([
    ['an HTTP error', () => json(466, { message: 'limit' }), 'check HTTP 466'],
    [
      'an answer that is not JSON',
      () => Promise.resolve(new Response('oops', { status: 200 })),
      'check bad response',
    ],
    [
      'an answer without the boolean',
      () => json(200, {}),
      'check bad response',
    ],
    [
      'a timeout',
      () => Promise.reject(new DOMException('aborted', 'TimeoutError')),
      'check timeout',
    ],
    [
      'a network error',
      () => Promise.reject(new TypeError(`fetch failed ${CREDENTIALS.token}`)),
      'check network',
    ],
  ])(
    'fails on a check with %s, sending nothing',
    async (_label, respond, reason) => {
      const fetchFn = fakeFetch(respond);

      const error = await sendError(fetchFn);

      expect(error.reason).toBe(reason);
      expect(fetchFn).toHaveBeenCalledTimes(1);
    },
  );

  it('shares one 10-second deadline and refuses redirects on every call', async () => {
    const timeout = vi.spyOn(AbortSignal, 'timeout');
    const fetchFn = greenApi(['22507020304']);

    await sendGreenApiMessage(CREDENTIALS, CI_PHONE, TEXT, fetchFn);

    expect(timeout).toHaveBeenCalledTimes(1);
    expect(timeout).toHaveBeenCalledWith(GREEN_API_TIMEOUT_MS);
    for (const { init } of calls(fetchFn)) {
      expect(init.signal).toBe(timeout.mock.results[0].value);
      expect(init.redirect).toBe('error');
    }
    timeout.mockRestore();
  });
});

describe('sendGreenApiMessage: Ivorian prefix must match the old operator (F-100)', () => {
  function greenApi() {
    return fakeFetch(() =>
      Promise.reject(new Error('unused')),
    ).mockImplementation((url: string) =>
      url.includes('/checkWhatsapp/')
        ? json(200, { existsWhatsapp: false })
        : json(200, { idMessage: 'id' }),
    );
  }

  it.each([
    ['Moov 01 for an old 02', '+2250102030405', 22502030405],
    ['MTN 05 for an old 54', '+2250554000000', 22554000000],
    ['Orange 07 for an old 77', '+2250777000000', 22577000000],
  ])(
    'checks the old ID when the prefix is right (%s)',
    async (_label, phone, old) => {
      const fetchFn = greenApi();

      await expect(
        sendGreenApiMessage(CREDENTIALS, phone, TEXT, fetchFn),
      ).rejects.toThrow(WhatsappSendError);

      const checked = (fetchFn.mock.calls as [string, RequestInit][]).map(
        ([, init]) =>
          (JSON.parse(init.body as string) as { phoneNumber: number })
            .phoneNumber,
      );
      expect(checked).toEqual([Number(phone.slice(1)), old]);
    },
  );

  it.each([
    ['Moov 01 with an Orange old number', '+2250107020304'],
    ['MTN 05 with a Moov old number', '+2250501020304'],
    ['Orange 07 with an MTN old number', '+2250754000000'],
    ['a fixed-line prefix', '+2252721000000'],
  ])(
    'never falls back on a mismatched prefix (%s): one check, then no account',
    async (_label, phone) => {
      const fetchFn = greenApi();

      const error = await sendGreenApiMessage(CREDENTIALS, phone, TEXT, fetchFn)
        .then(() => undefined)
        .catch((rejected: unknown) => rejected);

      expect(error).toBeInstanceOf(WhatsappSendError);
      expect((error as WhatsappSendError).reason).toBe('no WhatsApp account');
      expect(fetchFn).toHaveBeenCalledTimes(1);
    },
  );
});
