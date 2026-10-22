import type { INestApplication } from '@nestjs/common';
import type { App } from 'supertest/types.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { createTestApp } from './utils/app.js';
import { createMali, createStoreRecord } from './utils/countries.js';
import { resetDatabase } from './utils/reset-database.js';
import { createUser } from './utils/users.js';

// The goal rules the database enforces by itself (migration
// `projects_and_goals`), whatever the client of the database.
describe('Projects and goals schema (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let accountId: string;
  let customerId: string;
  let unassignedId: string;
  let cementId: string;
  let movementId: string;

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
  });

  beforeEach(async () => {
    await resetDatabase(prisma);
    await createMali(prisma);
    const store = await createStoreRecord(prisma, { status: 'VERIFIED' });
    const customer = await createUser(prisma, { phone: '+22376445566' });
    const seller = await createUser(prisma, { phone: '+22376000001' });
    customerId = customer.id;
    const account = await prisma.account.create({
      data: {
        number: 'C-000001',
        customerId,
        storeId: store.id,
        currencyCode: 'XOF',
        balance: 5000n,
        termsAcceptedAt: new Date(),
        openedById: seller.id,
        goals: {
          create: { label: 'Non affecté', isSystem: true, balance: 5000n },
        },
      },
      include: { goals: true },
    });
    accountId = account.id;
    unassignedId = account.goals[0].id;
    const project = await prisma.project.create({
      data: { accountId, name: 'Ma maison' },
    });
    cementId = (
      await prisma.goal.create({
        data: {
          accountId,
          projectId: project.id,
          label: 'Ciment',
          targetAmount: 150000n,
        },
      })
    ).id;
    movementId = (await move(unassignedId, cementId, 1000n)).id;
  });

  afterAll(async () => {
    await app.close();
  });

  const move = (sourceGoalId: string, targetGoalId: string, amount: bigint) =>
    prisma.goalMovement.create({
      data: {
        accountId,
        sourceGoalId,
        targetGoalId,
        amount,
        reason: 'MOVE',
        authorId: customerId,
      },
    });

  it.each([
    [
      'a Prisma update',
      () =>
        prisma.goalMovement.update({
          where: { id: movementId },
          data: { amount: 1n },
        }),
      /append-only: UPDATE refused/,
    ],
    [
      'a raw SQL UPDATE',
      () => prisma.$executeRaw`UPDATE "goal_movements" SET "amount" = 999`,
      /append-only: UPDATE refused/,
    ],
    [
      'a Prisma delete',
      () => prisma.goalMovement.delete({ where: { id: movementId } }),
      /append-only: DELETE refused/,
    ],
    [
      'a raw SQL DELETE',
      () => prisma.$executeRaw`DELETE FROM "goal_movements"`,
      /append-only: DELETE refused/,
    ],
  ])('refuses %s on a movement', async (_, change, message) => {
    await expect(change()).rejects.toThrow(message);

    expect(
      await prisma.goalMovement.findUniqueOrThrow({
        where: { id: movementId },
      }),
    ).toMatchObject({ amount: 1000n });
  });

  it.each([
    ['zero', 0n],
    ['negative', -100n],
  ])('refuses a %s movement amount', async (_, amount) => {
    await expect(move(unassignedId, cementId, amount)).rejects.toThrow(
      /goal_movements_amount_positive/,
    );
  });

  it('refuses a movement from a goal to itself', async () => {
    await expect(move(cementId, cementId, 100n)).rejects.toThrow(
      /goal_movements_distinct_goals/,
    );
  });

  it('refuses a negative goal balance', async () => {
    await expect(
      prisma.goal.update({
        where: { id: cementId },
        data: { balance: -1n },
      }),
    ).rejects.toThrow(/goals_balance_not_negative/);
  });

  it('refuses a negative account balance', async () => {
    await expect(
      prisma.account.update({
        where: { id: accountId },
        data: { balance: { decrement: 5001n } },
      }),
    ).rejects.toThrow(/accounts_balance_not_negative/);
  });

  it('accepts a zero balance', async () => {
    await expect(
      prisma.goal.update({ where: { id: cementId }, data: { balance: 0n } }),
    ).resolves.toMatchObject({ balance: 0n });
  });

  it('refuses a reused movement key and keeps closings key-free', async () => {
    const key = '0192f0a4-7b1c-7c3e-9d2a-5e6f7a8b9c0d';
    const withKey = (idempotencyKey: string | null) =>
      prisma.goalMovement.create({
        data: {
          accountId,
          sourceGoalId: cementId,
          targetGoalId: unassignedId,
          amount: 100n,
          reason: idempotencyKey ? 'MOVE' : 'GOAL_CLOSED',
          authorId: customerId,
          idempotencyKey,
        },
      });

    await withKey(key);
    await expect(withKey(key)).rejects.toMatchObject({ code: 'P2002' });
    // Several closings, each without a key.
    await withKey(null);
    await withKey(null);
    expect(
      await prisma.goalMovement.count({ where: { idempotencyKey: null } }),
    ).toBe(3);
  });
});
