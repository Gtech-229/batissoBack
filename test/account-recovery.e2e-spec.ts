import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { createTestApp } from './utils/app.js';
import { createMali, createStoreRecord } from './utils/countries.js';
import { resetDatabase } from './utils/reset-database.js';
import { CapturingSmsSender } from './utils/sms.js';
import { signedInStaff, type MobileStaff } from './utils/staff.js';
import { newDeviceKey, TEST_PIN } from './utils/users.js';

const NEW_PIN = '730164';
const NEW_DEVICE = 'device-new-phone-01';
const WRONG = [
  { answer: 'pas la bonne' },
  { answer: 'pas la bonne non plus' },
  { answer: 'toujours pas' },
];

interface Session {
  accessToken: string;
}

describe('Account recovery with security questions (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let customer: MobileStaff;
  let manager: MobileStaff;
  let storeId: string;
  let accountId: string;
  let ids: string[];
  const sms = new CapturingSmsSender();

  beforeAll(async () => {
    app = await createTestApp({ sms });
    prisma = app.get(PrismaService);
  });

  beforeEach(async () => {
    sms.messages = [];
    await resetDatabase(prisma);
    await createMali(prisma);
    storeId = (await createStoreRecord(prisma, { status: 'VERIFIED' })).id;
    manager = await signedInStaff(app, prisma, {
      phone: '+22376000000',
      firstName: 'Awa',
      store: { id: storeId, role: 'MANAGER' },
    });
    const seller = await signedInStaff(app, prisma, {
      phone: '+22376000001',
      firstName: 'Moussa',
      store: { id: storeId, role: 'SELLER' },
    });
    customer = await signedInStaff(app, prisma, {
      phone: '+22376445566',
      firstName: 'Fanta',
    });
    accountId = (
      (
        await api()
          .post(`/api/v1/stores/${storeId}/accounts`)
          .set('Authorization', seller.authorization)
          .send({
            customer: {
              phone: customer.phone,
              firstName: 'F',
              lastName: 'K',
            },
            termsAccepted: true,
          })
          .expect(201)
      ).body as { id: string }
    ).id;
    ids = [];
    for (const text of ['Une ?', 'Deux ?', 'Trois ?']) {
      const question = await prisma.securityQuestion.create({
        data: { text: `Question ${text}` },
      });
      ids.push(question.id);
    }
  });

  afterAll(async () => {
    await app.close();
  });

  const api = () => request(app.getHttpServer());

  const rightAnswers = () => [
    { questionId: ids[0], answer: 'École de Mandé' },
    { questionId: ids[1], answer: 'Fatou' },
    { questionId: ids[2], answer: 'Hamdallaye' },
  ];
  const wrongAnswers = () =>
    WRONG.map((wrong, index) => ({ questionId: ids[index], ...wrong }));

  const setAnswers = () =>
    api()
      .put('/api/v1/me/security-questions')
      .set('Authorization', customer.authorization)
      .send({ currentPin: TEST_PIN, answers: rightAnswers() })
      .expect(204);

  const errorOf = (res: { body: unknown }) =>
    (res.body as { error: string }).error;

  const stored = () =>
    prisma.user.findUniqueOrThrow({ where: { id: customer.userId } });

  /** No SMS left to send: the holder's last SMS is the next code. */
  const notificationsSent = () =>
    vi.waitFor(
      async () => {
        expect(
          await prisma.notification.count({ where: { status: 'PENDING' } }),
        ).toBe(0);
      },
      { timeout: 2000 },
    );

  async function verifiedCode(): Promise<{
    verificationToken: string;
    pinSet: boolean;
    securityQuestionsRequired: boolean;
  }> {
    await api()
      .post('/api/v1/auth/code')
      .send({ phone: customer.phone })
      .expect(202);
    const res = await api()
      .post('/api/v1/auth/code/verify')
      .send({
        phone: customer.phone,
        code: sms.lastCodeFor(customer.phone),
        deviceId: NEW_DEVICE,
      })
      .expect(200);
    return res.body as {
      verificationToken: string;
      pinSet: boolean;
      securityQuestionsRequired: boolean;
    };
  }

  const key = newDeviceKey();

  const recover = (verificationToken: string, answers: object[]) =>
    api().post('/api/v1/auth/recovery').send({
      verificationToken,
      answers,
      newPin: NEW_PIN,
      publicKey: key.publicKey,
      deviceName: 'Nouveau téléphone',
    });

  const questionsFor = (verificationToken: string) =>
    api().post('/api/v1/auth/recovery/questions').send({ verificationToken });

  describe('POST /auth/recovery/questions', () => {
    it('gives the user their questions, never the answers', async () => {
      await setAnswers();
      const { verificationToken } = await verifiedCode();

      const res = await questionsFor(verificationToken).expect(200);

      const { questions } = res.body as { questions: { id: string }[] };
      expect(questions.map((q) => q.id).sort()).toEqual([...ids].sort());
      expect(JSON.stringify(res.body)).not.toContain('Fatou');
    });

    it('needs a live token, and says when there are no questions', async () => {
      const { verificationToken } = await verifiedCode();

      const none = await questionsFor(verificationToken).expect(409);

      expect(errorOf(none)).toBe('RECOVERY_NOT_CONFIGURED');
      const bad = await questionsFor('not-a-real-token').expect(401);
      expect(errorOf(bad)).toBe('INVALID_VERIFICATION');
    });
  });

  describe('POST /auth/recovery', () => {
    it('resets everything and opens a session with the right answers', async () => {
      await setAnswers();
      const before = await stored();
      const { verificationToken, pinSet, securityQuestionsRequired } =
        await verifiedCode();
      expect(pinSet).toBe(true);
      expect(securityQuestionsRequired).toBe(false);

      const res = await recover(verificationToken, rightAnswers()).expect(200);

      const session = res.body as Session;
      await api()
        .get('/api/v1/me')
        .set('Authorization', `Bearer ${session.accessToken}`)
        .expect(200);
      await api()
        .get('/api/v1/me')
        .set('Authorization', customer.authorization)
        .expect(401);

      const after = await stored();
      expect(after.pinHash).not.toBeNull();
      expect(after.pinHash).not.toBe(before.pinHash);
      const devices = await prisma.userDevice.findMany({
        where: { userId: customer.userId },
      });
      const old = devices.find((d) => d.deviceId === customer.deviceId);
      expect(old?.publicKey).toBeNull();
      const fresh = devices.find((d) => d.deviceId === NEW_DEVICE);
      expect(fresh?.publicKey).toBe(key.publicKey);
    });

    it('signs in afterwards with the new PIN, not the old one', async () => {
      await setAnswers();
      const { verificationToken } = await verifiedCode();
      await recover(verificationToken, rightAnswers()).expect(200);

      const login = async (pin: string) => {
        const { challenge } = (
          await api()
            .post('/api/v1/auth/challenge')
            .send({ phone: customer.phone, deviceId: NEW_DEVICE })
            .expect(200)
        ).body as { challenge: string };
        return api()
          .post('/api/v1/auth/login')
          .send({
            phone: customer.phone,
            pin,
            deviceId: NEW_DEVICE,
            challenge,
            signature: key.sign(challenge),
          });
      };

      expect((await login(TEST_PIN)).status).toBe(401);
      expect((await login(NEW_PIN)).status).toBe(200);
    });

    it('tells the user in-app and by SMS, with no store and no push', async () => {
      await setAnswers();
      await prisma.userDevice.updateMany({
        where: { userId: customer.userId },
        data: { pushToken: 'push-token-of-the-lost-phone' },
      });
      const { verificationToken } = await verifiedCode();

      await recover(verificationToken, rightAnswers()).expect(200);
      await notificationsSent();

      const rows = await prisma.notification.findMany({
        where: { userId: customer.userId, type: 'ACCESS_RECOVERED' },
      });
      expect(rows.map((row) => row.channel).sort()).toEqual(['APP', 'SMS']);
      expect(rows.every((row) => row.storeId === null)).toBe(true);
      expect(
        sms.messages.some((m) => m.text.includes('votre code PIN a changé')),
      ).toBe(true);
    });

    it('accepts answers in any order, case, or accent', async () => {
      await setAnswers();
      const { verificationToken } = await verifiedCode();

      await recover(verificationToken, [
        { questionId: ids[2], answer: 'HAMDALLAYE' },
        { questionId: ids[0], answer: '  ecole  de mande ' },
        { questionId: ids[1], answer: 'fatou' },
      ]).expect(200);
    });

    it('asks every question the user picked, all five', async () => {
      const extra = [];
      for (const text of ['Quatre ?', 'Cinq ?']) {
        const question = await prisma.securityQuestion.create({
          data: { text: `Question ${text}` },
        });
        extra.push({ questionId: question.id, answer: `Réponse ${text}` });
      }
      const five = [...rightAnswers(), ...extra];
      await api()
        .put('/api/v1/me/security-questions')
        .set('Authorization', customer.authorization)
        .send({ currentPin: TEST_PIN, answers: five })
        .expect(204);
      const { verificationToken } = await verifiedCode();

      const shown = await questionsFor(verificationToken).expect(200);
      const { questions } = shown.body as { questions: unknown[] };
      expect(questions).toHaveLength(5);

      const three = await recover(verificationToken, rightAnswers()).expect(
        401,
      );
      expect(errorOf(three)).toBe('INVALID_RECOVERY_ANSWERS');
      expect((await stored()).failedRecoveryAttempts).toBe(1);

      await recover(verificationToken, five).expect(200);
    });

    it('uses a token once', async () => {
      await setAnswers();
      const { verificationToken } = await verifiedCode();
      await recover(verificationToken, rightAnswers()).expect(200);

      const res = await recover(verificationToken, rightAnswers()).expect(401);

      expect(errorOf(res)).toBe('INVALID_VERIFICATION');
    });

    it('refuses wrong answers, changes nothing, and keeps the token', async () => {
      await setAnswers();
      const before = await stored();
      const { verificationToken } = await verifiedCode();

      const res = await recover(verificationToken, wrongAnswers()).expect(401);

      expect(errorOf(res)).toBe('INVALID_RECOVERY_ANSWERS');
      const after = await stored();
      expect(after.pinHash).toBe(before.pinHash);
      expect(after.failedRecoveryAttempts).toBe(1);
      await api()
        .get('/api/v1/me')
        .set('Authorization', customer.authorization)
        .expect(200);

      await recover(verificationToken, rightAnswers()).expect(200);
      expect((await stored()).failedRecoveryAttempts).toBe(0);
    });

    it('refuses one wrong answer out of three, in the same words', async () => {
      await setAnswers();
      const { verificationToken } = await verifiedCode();
      const [first, second] = rightAnswers();

      const res = await recover(verificationToken, [
        first,
        second,
        { questionId: ids[2], answer: 'Badalabougou' },
      ]).expect(401);

      expect(res.body).toMatchObject({
        error: 'INVALID_RECOVERY_ANSWERS',
        message: 'Réponses incorrectes',
      });
    });

    it('counts answers to other questions as a wrong try', async () => {
      await setAnswers();
      const other = await prisma.securityQuestion.create({
        data: { text: 'Question hors liste ?' },
      });
      const { verificationToken } = await verifiedCode();
      const [first, second] = rightAnswers();

      const res = await recover(verificationToken, [
        first,
        second,
        { questionId: other.id, answer: 'Hamdallaye' },
      ]).expect(401);

      expect(errorOf(res)).toBe('INVALID_RECOVERY_ANSWERS');
    });

    it('locks recovery after 3 wrong tries, even with the right answers', async () => {
      await setAnswers();
      const before = await stored();
      const { verificationToken } = await verifiedCode();

      await recover(verificationToken, wrongAnswers()).expect(401);
      await recover(verificationToken, wrongAnswers()).expect(401);
      await recover(verificationToken, wrongAnswers()).expect(401);
      const res = await recover(verificationToken, rightAnswers()).expect(403);

      expect(errorOf(res)).toBe('RECOVERY_LOCKED');
      expect(JSON.stringify(res.body)).toContain('24 heures');
      const after = await stored();
      expect(after.pinHash).toBe(before.pinHash);
      expect(after.recoveryLockedUntil).not.toBeNull();
    });

    it('works again once the lock has expired', async () => {
      await setAnswers();
      await prisma.user.update({
        where: { id: customer.userId },
        data: { recoveryLockedUntil: new Date(Date.now() - 1000) },
      });
      const { verificationToken } = await verifiedCode();

      await recover(verificationToken, rightAnswers()).expect(200);

      expect((await stored()).recoveryLockedUntil).toBeNull();
    });

    it('counts tries in parallel one by one', async () => {
      await setAnswers();
      const { verificationToken } = await verifiedCode();

      const statuses = await Promise.all(
        [1, 2, 3, 4, 5].map(() =>
          recover(verificationToken, wrongAnswers()).then((res) => res.status),
        ),
      );

      expect(statuses.filter((status) => status === 401).length).toBe(3);
      expect(statuses.filter((status) => status === 403).length).toBe(2);
    });

    it('lets one of two parallel recoveries win', async () => {
      await setAnswers();
      const { verificationToken } = await verifiedCode();

      const statuses = await Promise.all(
        [1, 2].map(() =>
          recover(verificationToken, rightAnswers()).then((res) => res.status),
        ),
      );

      expect(statuses.sort((a, b) => a - b)).toEqual([200, 401]);
      expect(
        await prisma.userSession.count({
          where: { userId: customer.userId, revokedAt: null },
        }),
      ).toBe(1);
    });

    it('answers 409 when the user has no questions', async () => {
      const { verificationToken } = await verifiedCode();

      const res = await recover(verificationToken, rightAnswers()).expect(409);

      expect(errorOf(res)).toBe('RECOVERY_NOT_CONFIGURED');
    });

    it('refuses a bad token, a weak PIN, or too few answers', async () => {
      await setAnswers();
      const { verificationToken } = await verifiedCode();

      await recover('not-a-real-token', rightAnswers()).expect(401);
      await recover(verificationToken, rightAnswers().slice(0, 2)).expect(400);
      await api()
        .post('/api/v1/auth/recovery')
        .send({
          verificationToken,
          answers: rightAnswers(),
          newPin: '123456',
          publicKey: key.publicKey,
        })
        .expect(400);
      expect((await stored()).failedRecoveryAttempts).toBe(0);
    });
  });

  describe('after a manager reset', () => {
    const reset = () =>
      api()
        .post(`/api/v1/stores/${storeId}/accounts/${accountId}/access-reset`)
        .set('Authorization', manager.authorization)
        .expect(200);

    const choosePin = (verificationToken: string) =>
      api().post('/api/v1/auth/pin').send({
        verificationToken,
        pin: NEW_PIN,
        publicKey: key.publicKey,
      });

    it('refuses to choose a PIN with the SIM alone, then recovery works', async () => {
      await setAnswers();
      await reset();
      await notificationsSent();

      const { verificationToken, pinSet, securityQuestionsRequired } =
        await verifiedCode();
      expect(pinSet).toBe(false);
      expect(securityQuestionsRequired).toBe(true);

      const res = await choosePin(verificationToken).expect(403);
      expect(errorOf(res)).toBe('SECURITY_ANSWERS_REQUIRED');
      expect((await stored()).pinHash).toBeNull();

      await questionsFor(verificationToken).expect(200);
      await recover(verificationToken, rightAnswers()).expect(200);
      expect((await stored()).pinHash).not.toBeNull();
    });

    it('still lets someone without questions choose a PIN', async () => {
      await reset();
      await notificationsSent();

      const { verificationToken, securityQuestionsRequired } =
        await verifiedCode();

      expect(securityQuestionsRequired).toBe(false);
      await choosePin(verificationToken).expect(200);
    });

    const answerCount = () =>
      prisma.userSecurityAnswer.count({ where: { userId: customer.userId } });

    const resetClearing = (body: object) =>
      api()
        .post(`/api/v1/stores/${storeId}/accounts/${accountId}/access-reset`)
        .set('Authorization', manager.authorization)
        .send(body);

    it('keeps the answers without the flag, or with it false', async () => {
      await setAnswers();

      await reset();
      expect(await answerCount()).toBe(3);
      await resetClearing({ clearSecurityQuestions: false }).expect(200);

      expect(await answerCount()).toBe(3);
      expect(
        await prisma.activityLog.count({
          where: { action: 'SECURITY_QUESTIONS_CLEARED' },
        }),
      ).toBe(0);
    });

    it('removes the answers and the lock with the flag, and logs it', async () => {
      await setAnswers();
      await prisma.user.update({
        where: { id: customer.userId },
        data: {
          failedRecoveryAttempts: 2,
          recoveryLockedUntil: new Date(Date.now() + 3_600_000),
        },
      });

      await resetClearing({ clearSecurityQuestions: true }).expect(200);

      expect(await answerCount()).toBe(0);
      const user = await stored();
      expect(user.recoveryLockedUntil).toBeNull();
      expect(user.failedRecoveryAttempts).toBe(0);
      const cleared = await prisma.activityLog.findFirstOrThrow({
        where: { action: 'SECURITY_QUESTIONS_CLEARED' },
      });
      expect(cleared.userId).toBe(manager.userId);
      expect(cleared.storeId).toBe(storeId);
      expect(cleared.newValue).toEqual({ targetUserId: customer.userId });
      const log = await prisma.activityLog.findFirstOrThrow({
        where: { action: 'ACCESS_RESET' },
      });
      expect(log.newValue).toMatchObject({ securityQuestionsCleared: true });
    });

    it('lets the person in with an SMS code and a new PIN once cleared', async () => {
      await setAnswers();
      await resetClearing({ clearSecurityQuestions: true }).expect(200);
      await notificationsSent();

      const { verificationToken, securityQuestionsRequired } =
        await verifiedCode();

      expect(securityQuestionsRequired).toBe(false);
      await choosePin(verificationToken).expect(200);
    });

    it('logs no clearing when there was nothing to clear', async () => {
      await resetClearing({ clearSecurityQuestions: true }).expect(200);

      expect(
        await prisma.activityLog.count({
          where: { action: 'SECURITY_QUESTIONS_CLEARED' },
        }),
      ).toBe(0);
    });

    it('clears a seller too', async () => {
      const seller = await signedInStaff(app, prisma, {
        phone: '+22376000009',
        firstName: 'Ali',
        store: { id: storeId, role: 'SELLER' },
      });
      await api()
        .put('/api/v1/me/security-questions')
        .set('Authorization', seller.authorization)
        .send({ currentPin: TEST_PIN, answers: rightAnswers() })
        .expect(204);

      await api()
        .post(`/api/v1/stores/${storeId}/sellers/${seller.userId}/access-reset`)
        .set('Authorization', manager.authorization)
        .send({ clearSecurityQuestions: true })
        .expect(200);

      expect(
        await prisma.userSecurityAnswer.count({
          where: { userId: seller.userId },
        }),
      ).toBe(0);
    });

    it('refuses a flag that is not a boolean', async () => {
      await setAnswers();

      await resetClearing({ clearSecurityQuestions: 'yes' }).expect(400);

      expect(await answerCount()).toBe(3);
      expect((await stored()).pinHash).not.toBeNull();
    });

    it('kills a token in flight, answers or not', async () => {
      await setAnswers();
      const { verificationToken } = await verifiedCode();

      await reset();

      const res = await recover(verificationToken, rightAnswers()).expect(401);
      expect(errorOf(res)).toBe('INVALID_VERIFICATION');
    });
  });
});
