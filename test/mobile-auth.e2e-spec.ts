import { Logger, type INestApplication } from '@nestjs/common';
import { createHash, generateKeyPairSync } from 'node:crypto';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { verifyPassword } from '../src/admin-auth/secrets.js';
import { CODE_REQUESTED_MESSAGE } from '../src/mobile-auth/dto/code-responses.js';
import { codeMessage } from '../src/mobile-auth/mobile-auth.service.js';
import { pepperPin } from '../src/mobile-auth/pin-hasher.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { createTestApp } from './utils/app.js';
import { createMali } from './utils/countries.js';
import { resetDatabase } from './utils/reset-database.js';
import { CapturingSmsSender } from './utils/sms.js';
import {
  createUser,
  newDeviceKey,
  TEST_PHONE,
  TEST_PIN,
} from './utils/users.js';

const DEVICE = 'device-0001-abcd';

describe('Mobile auth (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  const sms = new CapturingSmsSender();

  beforeAll(async () => {
    app = await createTestApp({ sms });
    prisma = app.get(PrismaService);
  });

  beforeEach(async () => {
    await resetDatabase(prisma);
    sms.clear();
    await createMali(prisma);
  });

  afterAll(async () => {
    await app.close();
  });

  const api = () => request(app.getHttpServer());
  const requestCode = (phone: unknown) =>
    api().post('/api/v1/auth/code').send({ phone });
  const verifyCode = (body: Record<string, unknown>) =>
    api()
      .post('/api/v1/auth/code/verify')
      .send({ phone: TEST_PHONE, deviceId: DEVICE, ...body });

  /** Moves every code of the test phone back in time (past the cooldown). */
  const ageCodes = (ms: number) =>
    prisma.$executeRaw`
      UPDATE "phone_verifications"
      SET "createdAt" = "createdAt" - make_interval(secs => ${ms / 1000})`;

  /** The body without the per-request fields, to compare two error answers. */
  const stable = (body: Record<string, unknown>) => {
    const { timestamp: _timestamp, path: _path, ...rest } = body;
    return rest;
  };

  describe('POST /auth/code', () => {
    it.each(['76 00 00 00', '+223 76 00 00 00'])(
      'sends one French SMS with a 6-digit code to a known phone (%s)',
      async (phone) => {
        await createUser(prisma);

        const response = await requestCode(phone).expect(202);

        expect(response.body).toEqual({ message: CODE_REQUESTED_MESSAGE });
        expect(sms.messages).toHaveLength(1);
        const code = sms.lastCodeFor(TEST_PHONE);
        expect(sms.messages[0].text).toBe(codeMessage(code));
        // Only a hash is stored, never the code.
        const [row] = await prisma.phoneVerification.findMany();
        expect(row.phone).toBe(TEST_PHONE);
        expect(row.codeHash).not.toContain(code);
        expect(row.codeHash).toMatch(/^scrypt\$/);
      },
    );

    it('answers the same for an unknown phone and sends nothing', async () => {
      const response = await requestCode('76 11 11 11').expect(202);

      expect(response.body).toEqual({ message: CODE_REQUESTED_MESSAGE });
      expect(sms.messages).toEqual([]);
      expect(await prisma.phoneVerification.count()).toBe(0);
    });

    it('sends nothing while no country is active', async () => {
      await createUser(prisma);
      await prisma.country.update({
        where: { code: 'ML' },
        data: { active: false },
      });

      await requestCode('76 00 00 00').expect(202);

      expect(sms.messages).toEqual([]);
    });

    it.each([
      ['too short', '12'],
      ['another country', '+225 07 00 00 00 00'],
      ['not a number', 'abc'],
    ])(
      'refuses a phone that is %s with a French 400',
      async (_label, phone) => {
        const response = await requestCode(phone).expect(400);

        expect(response.body.details).toEqual([
          {
            field: 'phone',
            errors: ['Ce numéro de téléphone n’est pas valide'],
          },
        ]);
      },
    );

    it('refuses a missing phone', async () => {
      const response = await requestCode(undefined).expect(400);

      expect(response.body.details[0].field).toBe('phone');
    });

    it('sends at most one SMS per minute, silently', async () => {
      await createUser(prisma);

      await requestCode(TEST_PHONE).expect(202);
      await requestCode(TEST_PHONE).expect(202);

      expect(sms.messages).toHaveLength(1);
      await ageCodes(61_000);
      await requestCode(TEST_PHONE).expect(202);
      expect(sms.messages).toHaveLength(2);
    });

    it('sends at most 5 SMS per hour, silently', async () => {
      await createUser(prisma);
      for (let i = 0; i < 5; i++) {
        await requestCode(TEST_PHONE).expect(202);
        await ageCodes(61_000);
      }
      expect(sms.messages).toHaveLength(5);

      await requestCode(TEST_PHONE).expect(202);

      expect(sms.messages).toHaveLength(5);
    });

    it.each([
      [9, 1],
      [10, 0],
    ])(
      'with %i codes in the last 24 hours, sends %i SMS (daily cap of 10, F-14)',
      async (earlier, expected) => {
        await createUser(prisma);
        // Spread between 2 and 23 hours ago: past the cooldown and the hourly cap.
        const hoursAgo = (h: number) => new Date(Date.now() - h * 3_600_000);
        await prisma.phoneVerification.createMany({
          data: Array.from({ length: earlier }, (_, i) => ({
            phone: TEST_PHONE,
            codeHash: 'scrypt$old$old',
            expiresAt: hoursAgo(2 + i * 2),
            createdAt: hoursAgo(2.2 + i * 2),
          })),
        });

        const response = await requestCode(TEST_PHONE).expect(202);

        expect(response.body).toEqual({ message: CODE_REQUESTED_MESSAGE });
        expect(sms.messages).toHaveLength(expected);
      },
    );

    it('counts only the last 24 hours for the daily cap', async () => {
      await createUser(prisma);
      await prisma.phoneVerification.createMany({
        data: Array.from({ length: 10 }, () => ({
          phone: TEST_PHONE,
          codeHash: 'scrypt$old$old',
          expiresAt: new Date(Date.now() - 25 * 3_600_000),
          createdAt: new Date(Date.now() - 25 * 3_600_000),
        })),
      });

      await requestCode(TEST_PHONE).expect(202);

      expect(sms.messages).toHaveLength(1);
    });

    it('answers 202 even when the SMS provider fails, and logs no code (F-15)', async () => {
      await createUser(prisma);
      sms.mode = 'reject';
      const logged = vi
        .spyOn(Logger.prototype, 'error')
        .mockImplementation(() => {});

      const response = await requestCode(TEST_PHONE).expect(202);

      expect(response.body).toEqual({ message: CODE_REQUESTED_MESSAGE });
      expect(await prisma.phoneVerification.count()).toBe(1);
      // The failure is logged once the rejection settles.
      await vi.waitFor(() => expect(logged).toHaveBeenCalledTimes(1));
      const line = JSON.stringify(logged.mock.calls);
      expect(line).toContain('+223******00');
      expect(line).not.toContain(TEST_PHONE);
      expect(line).not.toContain(sms.lastCodeFor(TEST_PHONE));
      logged.mockRestore();
    });

    it('does not wait for the SMS provider before answering (F-15)', async () => {
      await createUser(prisma);
      sms.mode = 'hang';
      const started = Date.now();

      await requestCode(TEST_PHONE).expect(202);

      expect(Date.now() - started).toBeLessThan(2_000);
      expect(sms.messages).toHaveLength(1);
    });

    it('sends a single SMS for parallel requests', async () => {
      await createUser(prisma);

      await Promise.all(
        Array.from({ length: 5 }, () => requestCode(TEST_PHONE).expect(202)),
      );

      expect(sms.messages).toHaveLength(1);
      expect(await prisma.phoneVerification.count()).toBe(1);
    });
  });

  describe('POST /auth/code/verify', () => {
    async function codeFor(phone = TEST_PHONE) {
      await requestCode(phone).expect(202);
      return sms.lastCodeFor(phone);
    }

    it('turns the right code into a single-use token for this device', async () => {
      await createUser(prisma);
      const code = await codeFor();

      const response = await verifyCode({ code, phone: '76 00 00 00' }).expect(
        200,
      );

      expect(response.body).toEqual({
        verificationToken: expect.any(String),
        pinSet: false,
        expiresIn: 600,
      });
      const row = await prisma.phoneVerification.findFirstOrThrow();
      expect(row.verifiedAt).not.toBeNull();
      expect(row.deviceId).toBe(DEVICE);
      // Only the token's SHA-256 is stored.
      expect(row.tokenHash).toBe(
        createHash('sha256')
          .update(response.body.verificationToken)
          .digest('hex'),
      );
    });

    it('tells the app the user already has a PIN', async () => {
      await createUser(prisma, { pin: TEST_PIN });
      const code = await codeFor();

      const response = await verifyCode({ code }).expect(200);

      expect(response.body.pinSet).toBe(true);
    });

    it('refuses a wrong code, then kills the code after 5 wrong tries', async () => {
      await createUser(prisma);
      const code = await codeFor();
      const wrong = code === '000000' ? '111111' : '000000';

      for (let i = 0; i < 5; i++) {
        const response = await verifyCode({ code: wrong }).expect(401);
        expect(response.body).toMatchObject({
          error: 'INVALID_CODE',
          message: 'Code incorrect ou expiré. Demandez un nouveau code.',
        });
      }

      await verifyCode({ code }).expect(401);
    });

    it('counts parallel wrong tries one by one', async () => {
      await createUser(prisma);
      const code = await codeFor();
      const wrong = code === '000000' ? '111111' : '000000';

      await Promise.all(
        Array.from({ length: 10 }, () =>
          verifyCode({ code: wrong }).expect(401),
        ),
      );

      const row = await prisma.phoneVerification.findFirstOrThrow();
      expect(row.attempts).toBe(5);
      expect(row.consumedAt).not.toBeNull();
      await verifyCode({ code }).expect(401);
    });

    it('refuses an expired code', async () => {
      await createUser(prisma);
      const code = await codeFor();
      await prisma.phoneVerification.updateMany({
        data: { expiresAt: new Date(Date.now() - 1000) },
      });

      await verifyCode({ code }).expect(401);
    });

    it('refuses a code that was already used', async () => {
      await createUser(prisma);
      const code = await codeFor();
      await verifyCode({ code }).expect(200);

      await verifyCode({ code }).expect(401);
    });

    it('lets only one of two parallel right codes through', async () => {
      await createUser(prisma);
      const code = await codeFor();

      const statuses = (
        await Promise.all([verifyCode({ code }), verifyCode({ code })])
      )
        .map((r) => r.status)
        .sort((a, b) => a - b);

      expect(statuses).toEqual([200, 401]);
    });

    it('retires the previous code when a new one is sent', async () => {
      await createUser(prisma);
      const first = await codeFor();
      await ageCodes(61_000);
      const second = await codeFor();

      if (first !== second) {
        await verifyCode({ code: first }).expect(401);
      }
      await verifyCode({ code: second }).expect(200);
    });

    it('answers an unknown phone exactly like a wrong code', async () => {
      await createUser(prisma);
      await codeFor();

      const unknown = await verifyCode({
        phone: '76 11 11 11',
        code: '123123',
      }).expect(401);
      const wrong = await verifyCode({ code: '123123' }).expect(401);

      expect(stable(unknown.body)).toEqual(stable(wrong.body));
    });

    it.each([
      ['a code of 5 digits', { code: '12345' }, 'code'],
      ['a code with letters', { code: '12a456' }, 'code'],
      ['a short deviceId', { code: '123456', deviceId: 'abc' }, 'deviceId'],
      [
        'a deviceId with spaces',
        { code: '123456', deviceId: 'my phone 1' },
        'deviceId',
      ],
      ['no deviceId', { code: '123456', deviceId: undefined }, 'deviceId'],
    ])('refuses %s with a French 400', async (_label, body, field) => {
      const response = await verifyCode(body).expect(400);

      expect(
        response.body.details.map((d: { field: string }) => d.field),
      ).toEqual([field]);
    });
  });

  describe('POST /auth/pin', () => {
    const sha256 = (value: string) =>
      createHash('sha256').update(value).digest('hex');
    const claimsOf = (jwt: string) =>
      JSON.parse(
        Buffer.from(jwt.split('.')[1], 'base64url').toString('utf8'),
      ) as Record<string, unknown>;
    const deviceKey = newDeviceKey();
    const pinStep = (body: Record<string, unknown>) =>
      api()
        .post('/api/v1/auth/pin')
        .send({ publicKey: deviceKey.publicKey, ...body });

    /** SMS code requested and verified on `deviceId`: the token for the PIN step. */
    async function verificationToken(deviceId = DEVICE): Promise<string> {
      await ageCodes(61_000);
      await requestCode(TEST_PHONE).expect(202);
      const response = await verifyCode({
        code: sms.lastCodeFor(TEST_PHONE),
        deviceId,
      }).expect(200);
      return response.body.verificationToken as string;
    }

    it('activates the account: stores a PIN hash, trusts the device, opens a session', async () => {
      const user = await createUser(prisma);
      const token = await verificationToken();

      const response = await pinStep({
        verificationToken: token,
        pin: TEST_PIN,
        deviceName: '  Samsung A15 ',
      }).expect(200);

      expect(response.body).toEqual({
        accessToken: expect.any(String),
        refreshToken: expect.stringMatching(/^[0-9a-f-]{36}\.[\w-]{43}$/),
        expiresIn: 900,
        user: {
          id: user.id,
          firstName: 'Awa',
          lastName: 'Diallo',
          phone: TEST_PHONE,
        },
      });
      const [sessionId, secret] = response.body.refreshToken.split('.');
      expect(claimsOf(response.body.accessToken)).toMatchObject({
        sub: user.id,
        sid: sessionId,
        typ: 'user',
      });

      const stored = await prisma.user.findUniqueOrThrow({
        where: { id: user.id },
        include: { devices: true, sessions: true },
      });
      expect(stored.pinHash).toMatch(/^scrypt\$/);
      expect(stored.pinHash).not.toContain(TEST_PIN);
      // Peppered: the hash cannot be checked with the PIN alone.
      await expect(verifyPassword(TEST_PIN, stored.pinHash!)).resolves.toBe(
        false,
      );
      await expect(
        verifyPassword(
          pepperPin(TEST_PIN, process.env.PIN_PEPPER!),
          stored.pinHash!,
        ),
      ).resolves.toBe(true);
      expect(stored.devices).toMatchObject([
        {
          deviceId: DEVICE,
          name: 'Samsung A15',
          publicKey: deviceKey.publicKey,
        },
      ]);
      expect(stored.sessions).toMatchObject([
        { id: sessionId, refreshTokenHash: sha256(secret), revokedAt: null },
      ]);
      const verification = await prisma.phoneVerification.findFirstOrThrow({
        where: { tokenHash: sha256(token) },
      });
      expect(verification.consumedAt).not.toBeNull();
    });

    it('signs in a new device with the SMS code and the current PIN', async () => {
      const user = await createUser(prisma, { pin: TEST_PIN });

      await pinStep({
        verificationToken: await verificationToken('device-0002-efgh'),
        pin: TEST_PIN,
      }).expect(200);

      const devices = await prisma.userDevice.findMany({
        where: { userId: user.id },
      });
      expect(devices.map((d) => d.deviceId)).toEqual(['device-0002-efgh']);
    });

    it('counts a wrong PIN, keeps the token, and resets the count on success', async () => {
      const user = await createUser(prisma, { pin: TEST_PIN });
      const token = await verificationToken();

      const wrong = await pinStep({
        verificationToken: token,
        pin: '102938',
      }).expect(401);

      expect(wrong.body).toMatchObject({
        error: 'INVALID_CREDENTIALS',
        message: 'Numéro ou code PIN incorrect',
      });
      expect(
        (await prisma.user.findUniqueOrThrow({ where: { id: user.id } }))
          .failedPinAttempts,
      ).toBe(1);

      await pinStep({ verificationToken: token, pin: TEST_PIN }).expect(200);
      expect(
        (await prisma.user.findUniqueOrThrow({ where: { id: user.id } }))
          .failedPinAttempts,
      ).toBe(0);
    });

    it('locks the account after maxPinAttempts wrong PINs, even with the right one', async () => {
      await createUser(prisma, { pin: TEST_PIN });
      await prisma.systemSettings.create({
        data: { maxLoginAttempts: 5, maxAdminSessions: 3, maxPinAttempts: 3 },
      });
      const token = await verificationToken();

      for (let i = 0; i < 3; i++) {
        await pinStep({ verificationToken: token, pin: '102938' }).expect(401);
      }
      const locked = await pinStep({
        verificationToken: token,
        pin: TEST_PIN,
      }).expect(403);

      expect(locked.body).toMatchObject({
        error: 'PIN_LOCKED',
        message: 'Trop de codes PIN erronés. Réessayez dans 15 minutes.',
      });
      expect(await prisma.userSession.count()).toBe(0);
    });

    it('refuses a used, expired, or unknown verification token', async () => {
      await createUser(prisma);
      const token = await verificationToken();
      await pinStep({ verificationToken: token, pin: TEST_PIN }).expect(200);

      const used = await pinStep({
        verificationToken: token,
        pin: TEST_PIN,
      }).expect(401);
      expect(used.body.error).toBe('INVALID_VERIFICATION');

      const expired = await verificationToken('device-0002-efgh');
      await prisma.phoneVerification.updateMany({
        where: { tokenHash: sha256(expired) },
        data: { tokenExpiresAt: new Date(Date.now() - 1000) },
      });
      await pinStep({ verificationToken: expired, pin: TEST_PIN }).expect(401);

      await pinStep({ verificationToken: 'not-a-token', pin: TEST_PIN }).expect(
        401,
      );
    });

    it('lets only one of two parallel requests use the same token', async () => {
      await createUser(prisma);
      const token = await verificationToken();

      const statuses = (
        await Promise.all([
          pinStep({ verificationToken: token, pin: TEST_PIN }),
          pinStep({ verificationToken: token, pin: TEST_PIN }),
        ])
      )
        .map((r) => r.status)
        .sort((a, b) => a - b);

      expect(statuses).toEqual([200, 401]);
      expect(await prisma.userSession.count()).toBe(1);
    });

    it('never lets a second device overwrite a PIN chosen in parallel', async () => {
      const user = await createUser(prisma);
      const first = await verificationToken('device-0001-abcd');
      const second = await verificationToken('device-0002-efgh');

      const responses = await Promise.all([
        pinStep({ verificationToken: first, pin: '482915' }),
        pinStep({ verificationToken: second, pin: '739164' }),
      ]);

      expect(responses.map((r) => r.status).sort((a, b) => a - b)).toEqual([
        200, 401,
      ]);
      const winner = responses.findIndex((r) => r.status === 200);
      const loser = responses[1 - winner];
      expect(loser.body.error).toBe('INVALID_VERIFICATION');
      // The account now has a PIN: the other device signs in with that one.
      const stored = await prisma.user.findUniqueOrThrow({
        where: { id: user.id },
      });
      expect(stored.pinHash).not.toBeNull();
    });

    it('revokes the previous session of the same device', async () => {
      await createUser(prisma);
      const first = await pinStep({
        verificationToken: await verificationToken(),
        pin: TEST_PIN,
      }).expect(200);

      const second = await pinStep({
        verificationToken: await verificationToken(),
        pin: TEST_PIN,
      }).expect(200);

      const sessions = await prisma.userSession.findMany({
        orderBy: { createdAt: 'asc' },
      });
      expect(sessions).toHaveLength(2);
      expect(sessions[0].id).toBe(first.body.refreshToken.split('.')[0]);
      expect(sessions[0].revokedAt).not.toBeNull();
      expect(sessions[1].id).toBe(second.body.refreshToken.split('.')[0]);
      expect(sessions[1].revokedAt).toBeNull();
      expect(await prisma.userDevice.count()).toBe(1);
    });

    it('replaces the device key when the device is verified again by SMS', async () => {
      await createUser(prisma);
      await pinStep({
        verificationToken: await verificationToken(),
        pin: TEST_PIN,
      }).expect(200);
      const reinstalled = newDeviceKey();

      await pinStep({
        verificationToken: await verificationToken(),
        pin: TEST_PIN,
        publicKey: reinstalled.publicKey,
      }).expect(200);

      const devices = await prisma.userDevice.findMany();
      expect(devices.map((d) => d.publicKey)).toEqual([reinstalled.publicKey]);
    });

    it.each([
      [
        'a P-384 key',
        () =>
          generateKeyPairSync('ec', { namedCurve: 'secp384r1' })
            .publicKey.export({ format: 'der', type: 'spki' })
            .toString('base64'),
      ],
      [
        'an RSA key',
        () =>
          generateKeyPairSync('rsa', { modulusLength: 2048 })
            .publicKey.export({ format: 'der', type: 'spki' })
            .toString('base64'),
      ],
      ['garbage', () => 'bm90IGEga2V5'],
      ['nothing', () => undefined],
    ])(
      'refuses %s as the public key with a French 400',
      async (_label, key) => {
        await createUser(prisma);
        const token = await verificationToken();

        const response = await pinStep({
          verificationToken: token,
          pin: TEST_PIN,
          publicKey: key(),
        }).expect(400);

        expect(response.body.details).toEqual([
          {
            field: 'publicKey',
            errors: [
              'La clé publique doit être une clé EC P-256 au format SPKI DER, encodée en base64',
            ],
          },
        ]);
      },
    );

    it.each(['123456', '000000', '12345', 'abcdef'])(
      'refuses the PIN %s with a French 400',
      async (pin) => {
        await createUser(prisma);
        const token = await verificationToken();

        const response = await pinStep({
          verificationToken: token,
          pin,
        }).expect(400);

        expect(response.body.details).toEqual([
          {
            field: 'pin',
            errors: [
              'Le code PIN doit contenir exactement 6 chiffres, sans chiffres tous identiques ni suite (123456, 654321)',
            ],
          },
        ]);
        // The token was not used: the user can still choose a valid PIN.
        await pinStep({ verificationToken: token, pin: TEST_PIN }).expect(200);
      },
    );
  });

  describe('POST /auth/challenge', () => {
    const challengeFor = (phone: unknown, deviceId: unknown = DEVICE) =>
      api().post('/api/v1/auth/challenge').send({ phone, deviceId });

    it.each([
      ['a known phone', true],
      ['an unknown phone', false],
    ])(
      'gives a single-use challenge for %s, the same way',
      async (_label, known) => {
        if (known) {
          await createUser(prisma, { pin: TEST_PIN });
        }

        const response = await challengeFor('76 00 00 00').expect(200);

        expect(response.body).toEqual({
          challenge: expect.stringMatching(/^[\w-]{43}$/),
          expiresIn: 120,
        });
        const stored = await prisma.deviceChallenge.findUniqueOrThrow({
          where: { challenge: response.body.challenge },
        });
        expect(stored).toMatchObject({
          phone: TEST_PHONE,
          deviceId: DEVICE,
          usedAt: null,
        });
      },
    );

    it('validates the phone and the deviceId', async () => {
      await challengeFor('12').expect(400);
      await challengeFor(TEST_PHONE, 'abc').expect(400);
    });
  });

  describe('POST /auth/login', () => {
    const WRONG_PIN = '102938';
    const deviceKey = newDeviceKey();

    const challenge = async (phone = TEST_PHONE, deviceId = DEVICE) =>
      (
        await api()
          .post('/api/v1/auth/challenge')
          .send({ phone, deviceId })
          .expect(200)
      ).body.challenge as string;

    /** A login as the app sends it: a fresh challenge signed by the device key. */
    const login = async (
      body: Record<string, unknown> = {},
      key = deviceKey,
    ) => {
      const value = await challenge();
      return api()
        .post('/api/v1/auth/login')
        .send({
          phone: TEST_PHONE,
          pin: TEST_PIN,
          deviceId: DEVICE,
          challenge: value,
          signature: key.sign(value),
          ...body,
        });
    };

    /** Logs in and checks the status: supertest's `.expect` needs the request itself, not a promise. */
    const loginExpect = async (
      status: number,
      body: Record<string, unknown> = {},
      key = deviceKey,
    ): Promise<request.Response> => {
      const response = await login(body, key);
      expect(response.status).toBe(status);
      return response;
    };

    /** An activated user whose device registered `deviceKey` at its SMS step. */
    async function trustedUser(
      phone = TEST_PHONE,
      deviceId = DEVICE,
      publicKey: string | null = deviceKey.publicKey,
    ) {
      const user = await createUser(prisma, { phone, pin: TEST_PIN });
      await prisma.userDevice.create({
        data: { userId: user.id, deviceId, publicKey },
      });
      return user;
    }
    const setMaxPinAttempts = (maxPinAttempts: number) =>
      prisma.systemSettings.create({
        data: { maxLoginAttempts: 5, maxAdminSessions: 3, maxPinAttempts },
      });
    const failedAttempts = async (userId: string) =>
      (await prisma.user.findUniqueOrThrow({ where: { id: userId } }))
        .failedPinAttempts;

    it.each(['76 00 00 00', '+22376000000'])(
      'signs in a trusted device with its signature and the PIN (%s), without SMS',
      async (phone) => {
        const user = await trustedUser();

        const response = await loginExpect(200, { phone });

        expect(response.body.user).toEqual({
          id: user.id,
          firstName: 'Awa',
          lastName: 'Diallo',
          phone: TEST_PHONE,
        });
        expect(sms.messages).toEqual([]);
        const sessions = await prisma.userSession.findMany();
        expect(sessions.map((s) => s.id)).toEqual([
          response.body.refreshToken.split('.')[0],
        ]);
      },
    );

    describe('refuses an unproven device before looking at the PIN', () => {
      async function expectDeviceRefused(
        response: request.Response,
        userId: string,
      ) {
        expect(response.status).toBe(403);
        expect(response.body).toMatchObject({
          error: 'DEVICE_VERIFICATION_REQUIRED',
          message:
            'Nouvel appareil : confirmez votre numéro avec le code reçu par SMS.',
        });
        // Nothing counted: without the phone, nobody can lock the user out.
        expect(await failedAttempts(userId)).toBe(0);
        expect(await prisma.userSession.count()).toBe(0);
      }

      it('a signature by another key', async () => {
        const user = await trustedUser();

        await expectDeviceRefused(await login({}, newDeviceKey()), user.id);
      });

      it('a signature of another value', async () => {
        const user = await trustedUser();
        const value = await challenge();

        const response = await api()
          .post('/api/v1/auth/login')
          .send({
            phone: TEST_PHONE,
            pin: TEST_PIN,
            deviceId: DEVICE,
            challenge: value,
            signature: deviceKey.sign('something else'),
          });

        await expectDeviceRefused(response, user.id);
      });

      it('a challenge used twice', async () => {
        const user = await trustedUser();
        const value = await challenge();
        const body = {
          phone: TEST_PHONE,
          pin: TEST_PIN,
          deviceId: DEVICE,
          challenge: value,
          signature: deviceKey.sign(value),
        };
        await api().post('/api/v1/auth/login').send(body).expect(200);
        await prisma.userSession.deleteMany();

        await expectDeviceRefused(
          await api().post('/api/v1/auth/login').send(body),
          user.id,
        );
      });

      it('an expired challenge', async () => {
        const user = await trustedUser();
        const value = await challenge();
        await prisma.deviceChallenge.updateMany({
          data: { expiresAt: new Date(Date.now() - 1000) },
        });

        const response = await api()
          .post('/api/v1/auth/login')
          .send({
            phone: TEST_PHONE,
            pin: TEST_PIN,
            deviceId: DEVICE,
            challenge: value,
            signature: deviceKey.sign(value),
          });

        await expectDeviceRefused(response, user.id);
      });

      it('a challenge issued for another phone or device', async () => {
        const user = await trustedUser();
        for (const [phone, deviceId] of [
          ['+22376111111', DEVICE],
          [TEST_PHONE, 'device-0002-efgh'],
        ]) {
          const value = await challenge(phone, deviceId);

          const response = await api()
            .post('/api/v1/auth/login')
            .send({
              phone: TEST_PHONE,
              pin: TEST_PIN,
              deviceId: DEVICE,
              challenge: value,
              signature: deviceKey.sign(value),
            });

          await expectDeviceRefused(response, user.id);
        }
      });

      it('a device never verified, or verified without a key', async () => {
        const user = await trustedUser(TEST_PHONE, DEVICE, null);

        await expectDeviceRefused(await login(), user.id);
        await expectDeviceRefused(
          await login({ deviceId: 'device-0002-efgh' }),
          user.id,
        );
      });

      it('a device trusted by another user', async () => {
        await trustedUser('+22376111111', DEVICE);
        const user = await createUser(prisma, { pin: TEST_PIN });

        await expectDeviceRefused(await login(), user.id);
      });

      it('even with a wrong PIN: the same answer, still nothing counted', async () => {
        const user = await trustedUser();

        await expectDeviceRefused(
          await login({ pin: WRONG_PIN }, newDeviceKey()),
          user.id,
        );
      });
    });

    it('answers an unknown phone, an account without PIN, and an unproven device identically', async () => {
      await trustedUser();
      await createUser(prisma, { phone: '+22376222222' });

      const unknown = await loginExpect(403, { phone: '76 99 99 99' });
      const notActivated = await loginExpect(403, { phone: '76 22 22 22' });
      const unproven = await loginExpect(403, {}, newDeviceKey());

      expect(stable(unknown.body)).toEqual(stable(unproven.body));
      expect(stable(notActivated.body)).toEqual(stable(unproven.body));
    });

    it('counts a wrong PIN on a proven device and resets the count on success', async () => {
      const user = await trustedUser();

      const wrong = await loginExpect(401, { pin: WRONG_PIN });
      expect(wrong.body).toMatchObject({
        error: 'INVALID_CREDENTIALS',
        message: 'Numéro ou code PIN incorrect',
      });
      expect(await failedAttempts(user.id)).toBe(1);

      await loginExpect(200);
      expect(await failedAttempts(user.id)).toBe(0);
    });

    it('locks after maxPinAttempts wrong PINs (default 5), even with the right PIN', async () => {
      const user = await trustedUser();

      for (let i = 0; i < 5; i++) {
        await loginExpect(401, { pin: WRONG_PIN });
      }
      const locked = await loginExpect(403);

      expect(locked.body).toMatchObject({
        error: 'PIN_LOCKED',
        message: 'Trop de codes PIN erronés. Réessayez dans 15 minutes.',
      });
      const stored = await prisma.user.findUniqueOrThrow({
        where: { id: user.id },
      });
      expect(stored.pinLockedUntil?.getTime()).toBeGreaterThan(
        Date.now() + 14 * 60_000,
      );
    });

    it('unlocks once the lock delay is over', async () => {
      const user = await trustedUser();
      await prisma.user.update({
        where: { id: user.id },
        data: { pinLockedUntil: new Date(Date.now() - 1000) },
      });

      await loginExpect(200);
    });

    it('counts 20 parallel wrong PINs one by one: exactly maxPinAttempts 401', async () => {
      await trustedUser();
      // One challenge per attempt, fetched first, then all sent at once.
      const values = [];
      for (let i = 0; i < 20; i++) {
        values.push(await challenge());
      }

      const responses = await Promise.all(
        values.map((value) =>
          api()
            .post('/api/v1/auth/login')
            .send({
              phone: TEST_PHONE,
              pin: WRONG_PIN,
              deviceId: DEVICE,
              challenge: value,
              signature: deviceKey.sign(value),
            }),
        ),
      );

      const statuses = responses.map((r) => r.status);
      expect(statuses.filter((s) => s === 401)).toHaveLength(5);
      expect(statuses.filter((s) => s === 403)).toHaveLength(15);
      expect(
        responses.filter((r) => r.status === 403).map((r) => r.body.error),
      ).toEqual(Array(15).fill('PIN_LOCKED'));
      await loginExpect(403);
    });

    it('never locks when maxPinAttempts is 0', async () => {
      const user = await trustedUser();
      await setMaxPinAttempts(0);

      for (let i = 0; i < 12; i++) {
        await loginExpect(401, { pin: WRONG_PIN });
      }
      expect(await failedAttempts(user.id)).toBe(12);

      await loginExpect(200);
      expect(await failedAttempts(user.id)).toBe(0);
    });

    it('applies a changed maxPinAttempts from the next attempt', async () => {
      await trustedUser();
      await setMaxPinAttempts(3);

      for (let i = 0; i < 3; i++) {
        await loginExpect(401, { pin: WRONG_PIN });
      }
      await loginExpect(403);
    });

    it('checks only the PIN format at sign-in (a weak value is just a wrong PIN)', async () => {
      await trustedUser();

      await loginExpect(401, { pin: '123456' });
      const malformed = await loginExpect(400, { pin: '12a456' });
      expect(malformed.body.details).toEqual([
        { field: 'pin', errors: ['Le code PIN doit contenir 6 chiffres'] },
      ]);
    });

    it('refuses a signature that is not base64 with a French 400', async () => {
      await trustedUser();

      const response = await loginExpect(400, { signature: 'not base64 !' });

      expect(response.body.details).toEqual([
        {
          field: 'signature',
          errors: ['La signature doit être encodée en base64'],
        },
      ]);
    });
  });

  it('keeps admin routes behind the admin cookie', async () => {
    await api().get('/api/v1/admin/settings').expect(401);
  });
});
