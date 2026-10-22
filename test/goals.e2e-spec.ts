import type { INestApplication } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { createTestApp } from './utils/app.js';
import { createMali, createStoreRecord } from './utils/countries.js';
import { resetDatabase } from './utils/reset-database.js';
import { signedInStaff, type MobileStaff } from './utils/staff.js';

type GoalBody = {
  id: string;
  label: string;
  status: string;
  balance: string;
  targetAmount: string | null;
  projectId: string | null;
  reachedAt: string | null;
};

describe('Projects and goals (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let storeId: string;
  let seller: MobileStaff;
  let customer: MobileStaff;
  let other: MobileStaff;
  let accountId: string;
  let otherAccountId: string;
  let unassignedId: string;

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
  });

  beforeEach(async () => {
    await resetDatabase(prisma);
    await createMali(prisma);
    storeId = (await createStoreRecord(prisma, { status: 'VERIFIED' })).id;
    seller = await signedInStaff(app, prisma, {
      phone: '+22376000001',
      firstName: 'Moussa',
      store: { id: storeId, role: 'SELLER' },
    });
    customer = await signedInStaff(app, prisma, {
      phone: '+22376445566',
      firstName: 'Fanta',
    });
    other = await signedInStaff(app, prisma, {
      phone: '+22376112233',
      firstName: 'Ali',
    });
    accountId = await openAccount(customer.phone);
    otherAccountId = await openAccount(other.phone);
    unassignedId = (
      await prisma.goal.findFirstOrThrow({
        where: { accountId, isSystem: true },
      })
    ).id;
    await api()
      .post(`/api/v1/stores/${storeId}/accounts/${accountId}/deposits`)
      .set('Authorization', seller.authorization)
      .set('Idempotency-Key', randomUUID())
      .send({ amount: '50000' })
      .expect(201);
  });

  afterAll(async () => {
    await app.close();
  });

  const api = () => request(app.getHttpServer());
  const openAccount = async (phone: string) =>
    (
      await api()
        .post(`/api/v1/stores/${storeId}/accounts`)
        .set('Authorization', seller.authorization)
        .send({
          customer: { phone, firstName: 'X', lastName: 'Y' },
          termsAccepted: true,
        })
        .expect(201)
    ).body.id as string;
  const me = (as: MobileStaff, account = accountId) =>
    `/api/v1/me/accounts/${account}`;
  const createGoal = (
    body: Record<string, unknown>,
    as = customer,
    account = accountId,
  ) =>
    api()
      .post(`${me(as, account)}/goals`)
      .set('Authorization', as.authorization)
      .send({ label: 'Ciment', targetAmount: '150000', ...body });
  const createProject = (
    name = 'Ma maison',
    as = customer,
    account = accountId,
  ) =>
    api()
      .post(`${me(as, account)}/projects`)
      .set('Authorization', as.authorization)
      .send({ name });
  const patchGoal = (
    goalId: string,
    body: Record<string, unknown>,
    as = customer,
    account = accountId,
  ) =>
    api()
      .patch(`${me(as, account)}/goals/${goalId}`)
      .set('Authorization', as.authorization)
      .send(body);
  const closeGoal = (goalId: string, as = customer, account = accountId) =>
    api()
      .post(`${me(as, account)}/goals/${goalId}/close`)
      .set('Authorization', as.authorization);
  /** Puts money into a goal, taken from Unassigned (moves come in step 4). */
  const fund = async (goalId: string, amount: bigint) => {
    await prisma.goal.update({
      where: { id: unassignedId },
      data: { balance: { decrement: amount } },
    });
    await prisma.goal.update({
      where: { id: goalId },
      data: { balance: { increment: amount } },
    });
  };
  const expectSumMatches = async (account = accountId) => {
    const row = await prisma.account.findUniqueOrThrow({
      where: { id: account },
      include: { goals: true },
    });
    const sum = row.goals.reduce((total, goal) => total + goal.balance, 0n);
    expect(sum).toBe(row.balance);
  };

  describe('creating', () => {
    it('creates a project and a goal in it', async () => {
      const project = await createProject().expect(201);
      const goal = await createGoal({ projectId: project.body.id }).expect(201);

      expect(project.body).toEqual({
        id: expect.any(String),
        name: 'Ma maison',
        createdAt: expect.any(String),
      });
      expect(goal.body).toEqual({
        id: expect.any(String),
        label: 'Ciment',
        isSystem: false,
        targetAmount: '150000',
        status: 'IN_PROGRESS',
        balance: '0',
        projectId: project.body.id,
        reachedAt: null,
      });
    });

    it('creates a goal outside any project, with trimmed text', async () => {
      const goal = await createGoal({ label: '  Fer à béton ' }).expect(201);

      expect(goal.body).toMatchObject({
        label: 'Fer à béton',
        projectId: null,
      });
    });

    it('shows projects and goals in /me/accounts and the staff detail', async () => {
      const project = await createProject().expect(201);
      await createGoal({ projectId: project.body.id }).expect(201);

      const mine = await api()
        .get('/api/v1/me/accounts')
        .set('Authorization', customer.authorization)
        .expect(200);
      const detail = await api()
        .get(`/api/v1/stores/${storeId}/accounts/${accountId}`)
        .set('Authorization', seller.authorization)
        .expect(200);

      for (const view of [mine.body[0], detail.body]) {
        expect(view.projects).toEqual([project.body]);
        expect(
          (view.goals as GoalBody[]).map((goal) => [
            goal.label,
            goal.projectId,
          ]),
        ).toEqual([
          ['Non affecté', null],
          ['Ciment', project.body.id],
        ]);
      }
    });

    it.each([
      ['an empty label', { label: '  ' }, 'label'],
      ['a label over 100 characters', { label: 'x'.repeat(101) }, 'label'],
      ['a zero target', { targetAmount: '0' }, 'targetAmount'],
      ['a missing target', { targetAmount: undefined }, 'targetAmount'],
      ['a malformed project id', { projectId: 'p-1' }, 'projectId'],
    ])('refuses a goal with %s (French 400)', async (_, body, field) => {
      const response = await createGoal(body).expect(400);

      expect(response.body.details).toContainEqual(
        expect.objectContaining({ field }),
      );
    });

    it('refuses an empty project name', async () => {
      await createProject('').expect(400);
    });

    it('answers 404 to a project of another account', async () => {
      const foreign = await createProject(
        'Chez Ali',
        other,
        otherAccountId,
      ).expect(201);

      const response = await createGoal({ projectId: foreign.body.id }).expect(
        404,
      );

      expect(response.body.message).toBe('Projet introuvable');
    });
  });

  describe('editing', () => {
    let goalId: string;

    beforeEach(async () => {
      goalId = ((await createGoal({})).body as GoalBody).id;
    });

    it('renames a goal', async () => {
      const response = await patchGoal(goalId, { label: 'Ciment CPA' }).expect(
        200,
      );

      expect(response.body).toMatchObject({
        label: 'Ciment CPA',
        targetAmount: '150000',
      });
    });

    it('follows a new target: REACHED when met, back when raised, never notifying', async () => {
      await fund(goalId, 40000n);

      const reached = await patchGoal(goalId, {
        targetAmount: '40000',
      }).expect(200);
      expect(reached.body).toMatchObject({
        status: 'REACHED',
        reachedAt: expect.any(String),
      });

      const raised = await patchGoal(goalId, { targetAmount: '45000' }).expect(
        200,
      );
      expect(raised.body).toMatchObject({
        status: 'IN_PROGRESS',
        reachedAt: null,
      });
      expect(
        await prisma.notification.count({ where: { type: 'GOAL_REACHED' } }),
      ).toBe(0);
    });

    it.each([
      ['nothing to change', {}],
      ['a null target', { targetAmount: null }],
      ['a null label', { label: null }],
      ['a negative target', { targetAmount: '-5' }],
    ])('refuses %s with a 400', async (_, body) => {
      await patchGoal(goalId, body).expect(400);
    });

    it('refuses to change the Unassigned goal with 409 SYSTEM_GOAL', async () => {
      const response = await patchGoal(unassignedId, { label: 'Autre' }).expect(
        409,
      );

      expect(response.body).toMatchObject({
        error: 'SYSTEM_GOAL',
        message:
          'L’objectif « Non affecté » ne peut être ni renommé, ni modifié, ni fermé',
      });
    });
  });

  describe('closing', () => {
    let goalId: string;

    beforeEach(async () => {
      goalId = ((await createGoal({})).body as GoalBody).id;
    });

    it('sends what the goal holds back to Unassigned, recorded as a movement', async () => {
      await fund(goalId, 30000n);

      const response = await closeGoal(goalId).expect(200);

      expect(response.body).toMatchObject({
        id: goalId,
        status: 'CLOSED',
        balance: '0',
      });
      expect(
        (await prisma.goal.findUniqueOrThrow({ where: { id: unassignedId } }))
          .balance,
      ).toBe(50000n);
      expect(await prisma.goalMovement.findMany()).toMatchObject([
        {
          accountId,
          sourceGoalId: goalId,
          targetGoalId: unassignedId,
          amount: 30000n,
          reason: 'GOAL_CLOSED',
          authorId: customer.userId,
          idempotencyKey: null,
          device: customer.deviceId,
        },
      ]);
      await expectSumMatches();
      expect(
        (await prisma.account.findUniqueOrThrow({ where: { id: accountId } }))
          .balance,
      ).toBe(50000n);
    });

    it('closes an empty goal without a movement', async () => {
      await closeGoal(goalId).expect(200);

      expect(await prisma.goalMovement.count()).toBe(0);
    });

    it('keeps a closed goal visible and refuses to change or close it again', async () => {
      await closeGoal(goalId).expect(200);

      await patchGoal(goalId, { label: 'X' })
        .expect(409)
        .expect((r) => expect(r.body.error).toBe('GOAL_CLOSED'));
      await closeGoal(goalId)
        .expect(409)
        .expect((r) => expect(r.body.error).toBe('GOAL_CLOSED'));
      const mine = await api()
        .get('/api/v1/me/accounts')
        .set('Authorization', customer.authorization)
        .expect(200);
      expect(
        (mine.body[0].goals as GoalBody[]).find((goal) => goal.id === goalId),
      ).toMatchObject({ status: 'CLOSED', balance: '0' });
    });

    it('refuses to close the Unassigned goal', async () => {
      await closeGoal(unassignedId)
        .expect(409)
        .expect((r) => expect(r.body.error).toBe('SYSTEM_GOAL'));
    });
  });

  describe('isolation', () => {
    it('answers 404 to another customer on every route', async () => {
      const goalId = ((await createGoal({})).body as GoalBody).id;

      await createProject('X', other).expect(404);
      await createGoal({}, other).expect(404);
      await patchGoal(goalId, { label: 'X' }, other).expect(404);
      await closeGoal(goalId, other).expect(404);
    });

    it('answers 404 to the store’s staff through /me', async () => {
      await createGoal({}, seller)
        .expect(404)
        .expect((r) => expect(r.body.message).toBe('Compte introuvable'));
    });

    it('answers 404 to a goal of another account through one’s own account', async () => {
      const foreign = (
        (await createGoal({}, other, otherAccountId)).body as GoalBody
      ).id;

      await patchGoal(foreign, { label: 'X' })
        .expect(404)
        .expect((r) => expect(r.body.message).toBe('Objectif introuvable'));
      await closeGoal(foreign).expect(404);
    });

    it('answers 400 to malformed ids and 401 without a session', async () => {
      await createGoal({}, customer, 'not-a-uuid').expect(400);
      await patchGoal('not-a-uuid', { label: 'X' })
        .expect(400)
        .expect((r) =>
          expect(r.body.message).toBe('Identifiant d’objectif invalide'),
        );
      await api()
        .post(`${me(customer)}/goals`)
        .send({})
        .expect(401);
    });
  });
});
