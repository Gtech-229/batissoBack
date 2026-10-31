import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { createTestApp } from './utils/app.js';
import { createMali } from './utils/countries.js';
import { resetDatabase } from './utils/reset-database.js';
import { signedInStaff, type MobileStaff } from './utils/staff.js';
import { TEST_PIN } from './utils/users.js';

const UNKNOWN_ID = '0192f0a4-7b1c-7c3e-9d2a-5e6f7a8b9c0d';

describe('Security questions (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
  });

  beforeEach(async () => {
    await resetDatabase(prisma);
  });

  afterAll(async () => {
    await app.close();
  });

  const api = () => request(app.getHttpServer());
  it('has no admin routes: the list is set by migrations', async () => {
    await api().get('/api/v1/admin/security-questions').expect(404);
    await api().post('/api/v1/admin/security-questions').expect(404);
  });

  describe('a user setting their answers', () => {
    const MINE = '/api/v1/me/security-questions';
    let staff: MobileStaff;
    let ids: string[];
    let inactiveId: string;

    const answersFor = (questionIds = ids) =>
      questionIds.map((questionId, index) => ({
        questionId,
        answer: `Réponse ${index + 1}`,
      }));

    const set = (body: object) =>
      api().put(MINE).set('Authorization', staff.authorization).send(body);

    const errorOf = (res: { body: unknown }) =>
      (res.body as { error: string }).error;

    const stored = () =>
      prisma.userSecurityAnswer.findMany({ where: { userId: staff.userId } });

    beforeEach(async () => {
      await createMali(prisma);
      staff = await signedInStaff(app, prisma, { phone: '+22376000000' });
      for (let i = 1; i <= 6; i += 1) {
        await prisma.securityQuestion.create({
          data: { text: `Question offerte ${i} ?` },
        });
      }
      const inactive = await prisma.securityQuestion.create({
        data: { text: 'Question retirée ?', active: false },
      });
      inactiveId = inactive.id;
      ids = (
        await prisma.securityQuestion.findMany({
          where: { active: true },
          orderBy: { text: 'asc' },
        })
      )
        .slice(0, 3)
        .map((question) => question.id);
    });

    it('offers the active questions and has nothing set at first', async () => {
      const res = await api()
        .get(MINE)
        .set('Authorization', staff.authorization)
        .expect(200);

      const body = res.body as {
        configured: boolean;
        chosen: unknown[];
        available: { id: string }[];
      };
      expect(body.configured).toBe(false);
      expect(body.chosen).toEqual([]);
      expect(body.available).toHaveLength(6);
      expect(body.available.map((q) => q.id)).not.toContain(inactiveId);
    });

    it('stores three hashed answers and returns neither answers nor hashes', async () => {
      await set({ currentPin: TEST_PIN, answers: answersFor() }).expect(204);

      const rows = await stored();
      expect(rows).toHaveLength(3);
      expect(rows.every((row) => !row.answerHash.includes('ponse'))).toBe(true);

      const res = await api()
        .get(MINE)
        .set('Authorization', staff.authorization)
        .expect(200);
      const text = JSON.stringify(res.body);
      expect((res.body as { configured: boolean }).configured).toBe(true);
      expect(text).not.toContain('ponse 1');
      expect(text).not.toContain(rows[0].answerHash);
    });

    it('shows a chosen question that was deactivated since', async () => {
      await set({ currentPin: TEST_PIN, answers: answersFor() }).expect(204);
      await prisma.securityQuestion.update({
        where: { id: ids[0] },
        data: { active: false },
      });

      const res = await api()
        .get(MINE)
        .set('Authorization', staff.authorization)
        .expect(200);

      const { chosen } = res.body as { chosen: { id: string }[] };
      expect(chosen.map((q) => q.id)).toContain(ids[0]);
    });

    it('replaces the answers, all three', async () => {
      await set({ currentPin: TEST_PIN, answers: answersFor() }).expect(204);
      const before = await stored();
      const others = await prisma.securityQuestion.findMany({
        where: { active: true, id: { not: ids[0] } },
        take: 3,
      });

      await set({
        currentPin: TEST_PIN,
        answers: answersFor(others.map((question) => question.id)),
      }).expect(204);

      const after = await stored();
      expect(after).toHaveLength(3);
      expect(after.map((row) => row.questionId)).not.toContain(ids[0]);
      expect(after.map((row) => row.answerHash)).not.toContain(
        before[1].answerHash,
      );
    });

    it('refuses a wrong PIN and counts the attempt', async () => {
      const res = await set({
        currentPin: '111222',
        answers: answersFor(),
      }).expect(400);

      expect(errorOf(res)).toBe('INVALID_PIN');
      expect(await stored()).toHaveLength(0);
      const user = await prisma.user.findUniqueOrThrow({
        where: { id: staff.userId },
      });
      expect(user.failedPinAttempts).toBe(1);
    });

    it('locks after too many wrong PINs, even with the right one', async () => {
      await prisma.systemSettings.create({
        data: { maxLoginAttempts: 5, maxAdminSessions: 3, maxPinAttempts: 2 },
      });

      await set({ currentPin: '111222', answers: answersFor() });
      await set({ currentPin: '111222', answers: answersFor() });
      const res = await set({
        currentPin: TEST_PIN,
        answers: answersFor(),
      }).expect(403);

      expect(errorOf(res)).toBe('PIN_LOCKED');
      expect(await stored()).toHaveLength(0);
    });

    it.each([3, 4, 5])('accepts %i answers', async (count) => {
      const offered = await prisma.securityQuestion.findMany({
        where: { active: true },
        take: count,
      });

      await set({
        currentPin: TEST_PIN,
        answers: answersFor(offered.map((question) => question.id)),
      }).expect(204);

      expect(await stored()).toHaveLength(count);
    });

    it('replaces 5 answers with 3, leaving none behind', async () => {
      const offered = await prisma.securityQuestion.findMany({
        where: { active: true },
        take: 5,
      });
      await set({
        currentPin: TEST_PIN,
        answers: answersFor(offered.map((question) => question.id)),
      }).expect(204);

      await set({ currentPin: TEST_PIN, answers: answersFor() }).expect(204);

      expect(await stored()).toHaveLength(3);
    });

    it('needs 3 to 5 answers', async () => {
      const others = await prisma.securityQuestion.findMany({
        where: { active: true },
      });

      await set({
        currentPin: TEST_PIN,
        answers: answersFor(ids.slice(0, 2)),
      }).expect(400);
      await set({
        currentPin: TEST_PIN,
        answers: answersFor(others.map((question) => question.id)),
      }).expect(400);
      await set({ currentPin: TEST_PIN }).expect(400);
    });

    it('refuses the same question twice, at no PIN cost', async () => {
      const res = await set({
        currentPin: '111222',
        answers: answersFor([ids[0], ids[0], ids[1]]),
      }).expect(400);

      expect(errorOf(res)).toBe('SECURITY_ANSWERS_NOT_DISTINCT');
      const user = await prisma.user.findUniqueOrThrow({
        where: { id: staff.userId },
      });
      expect(user.failedPinAttempts).toBe(0);
    });

    it('refuses the same answer twice, whatever its case and accents', async () => {
      const res = await set({
        currentPin: TEST_PIN,
        answers: [
          { questionId: ids[0], answer: 'École' },
          { questionId: ids[1], answer: 'ecole' },
          { questionId: ids[2], answer: 'Autre' },
        ],
      }).expect(400);

      expect(errorOf(res)).toBe('SECURITY_ANSWERS_NOT_DISTINCT');
    });

    it('refuses an inactive or unknown question', async () => {
      const inactive = await set({
        currentPin: TEST_PIN,
        answers: answersFor([ids[0], ids[1], inactiveId]),
      }).expect(400);
      expect(errorOf(inactive)).toBe('SECURITY_QUESTION_UNAVAILABLE');

      const unknown = await set({
        currentPin: TEST_PIN,
        answers: answersFor([ids[0], ids[1], UNKNOWN_ID]),
      }).expect(400);
      expect(errorOf(unknown)).toBe('SECURITY_QUESTION_UNAVAILABLE');
    });

    it('refuses an answer too short or too long, counted after normalizing', async () => {
      const withAnswer = (answer: string) => ({
        currentPin: TEST_PIN,
        answers: [
          { questionId: ids[0], answer },
          { questionId: ids[1], answer: 'Deux' },
          { questionId: ids[2], answer: 'Trois' },
        ],
      });

      await set(withAnswer('  a  ')).expect(400);
      await set(withAnswer('x'.repeat(101))).expect(400);
      await set({
        ...withAnswer('ok'),
        answers: [{ questionId: 'not-a-uuid', answer: 'ok' }, 1, 2],
      }).expect(400);
    });

    it('needs a session', async () => {
      await api().get(MINE).expect(401);
      await api()
        .put(MINE)
        .send({ currentPin: TEST_PIN, answers: answersFor() })
        .expect(401);
    });
  });
});
