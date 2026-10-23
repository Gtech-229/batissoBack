import { Injectable } from '@nestjs/common';
import { accountNotFound } from '../accounts/accounts.errors.js';
import {
  GOAL_INCLUDE,
  toGoalView,
  toProjectView,
  type GoalView,
  type ProjectView,
} from '../accounts/dto/account-detail.js';
import {
  articleNotFound,
  articleUnavailable,
} from '../catalogue/catalogue.errors.js';
import { formatAmount, parseAmount } from '../common/money.js';
import {
  ONE_SNAPSHOT,
  paginated,
  toSkipTake,
  type Paginated,
  type PaginationQueryDto,
} from '../common/pagination.js';
import {
  GoalMovementReason,
  GoalStatus,
  Prisma,
} from '../generated/prisma/client.js';
import type { AuthenticatedUser } from '../mobile-auth/authenticated-user.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type {
  CreateGoalDto,
  CreateProjectDto,
  UpdateGoalDto,
} from './dto/goal-inputs.dto.js';
import {
  MOVEMENT_INCLUDE,
  toGoalMovementView,
  type GoalMovementView,
  type MoveBetweenGoalsDto,
} from './dto/goal-movement.dto.js';
import { nextGoalState } from './goal-state.js';
import {
  goalClosed,
  goalNotFound,
  insufficientGoalBalance,
  movementKeyReused,
  nothingToUpdate,
  projectNotFound,
  sameGoal,
  systemGoal,
} from './goals.errors.js';

type Tx = Prisma.TransactionClient;

/** What makes a retry the same move as the one its key recorded. */
interface MoveRequest {
  accountId: string;
  authorId: string;
  sourceGoalId: string;
  targetGoalId: string;
  amount: bigint;
}

/**
 * A customer's projects and goals, under `/me`: the account must be the
 * session user's own (anything else is a 404). Every change to a goal balance
 * runs under the account row lock (`FOR UPDATE`), like deposits, so the goals
 * of an account always sum to its balance.
 */
@Injectable()
export class GoalsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  /**
   * Moves money between two goals of the customer's account. Not an operation:
   * the account balance never changes, only how it is split. One transaction,
   * under the account row lock (the same lock as deposits, so the source
   * balance read here cannot change before the write). Idempotent like
   * deposits: a retry with the same key gives back the recorded movement.
   */
  async move(
    actor: AuthenticatedUser,
    accountId: string,
    dto: MoveBetweenGoalsDto,
    idempotencyKey: string,
  ): Promise<{ movement: GoalMovementView; replayed: boolean }> {
    const request: MoveRequest = {
      accountId,
      authorId: actor.userId,
      sourceGoalId: dto.sourceGoalId.toLowerCase(),
      targetGoalId: dto.targetGoalId.toLowerCase(),
      amount: parseAmount(dto.amount),
    };
    if (request.sourceGoalId === request.targetGoalId) {
      throw sameGoal();
    }

    const earlier = await this.replay(this.prisma, idempotencyKey, request);
    if (earlier) {
      return earlier;
    }

    try {
      const { result, toNotify } = await this.prisma.$transaction(
        async (tx) => {
          await this.ownAccount(tx, actor.userId, accountId, { lock: true });
          // Asked again under the lock: a parallel retry waited here.
          const parallel = await this.replay(tx, idempotencyKey, request);
          if (parallel) {
            return { result: parallel, toNotify: [] };
          }

          const goals = await tx.goal.findMany({
            where: {
              accountId,
              id: { in: [request.sourceGoalId, request.targetGoalId] },
            },
          });
          const source = goals.find((g) => g.id === request.sourceGoalId);
          const target = goals.find((g) => g.id === request.targetGoalId);
          if (!source || !target) {
            throw goalNotFound();
          }
          if (target.status === GoalStatus.CLOSED) {
            throw goalClosed();
          }
          const account = await tx.account.findUniqueOrThrow({
            where: { id: accountId },
            include: { store: { select: { name: true } } },
          });
          if (source.balance < request.amount) {
            throw insufficientGoalBalance(
              formatAmount(source.balance),
              account.currencyCode,
            );
          }

          const movement = await tx.goalMovement.create({
            data: {
              accountId,
              sourceGoalId: source.id,
              targetGoalId: target.id,
              amount: request.amount,
              reason: GoalMovementReason.MOVE,
              authorId: actor.userId,
              idempotencyKey,
              device: actor.deviceId,
            },
            include: MOVEMENT_INCLUDE,
          });
          // Both statuses follow: the source may fall below its target, the
          // target may reach it (only that notifies).
          const sourceBalance = source.balance - request.amount;
          const sourceState = nextGoalState(source, sourceBalance);
          await tx.goal.update({
            where: { id: source.id },
            data: {
              balance: sourceBalance,
              status: sourceState.status,
              reachedAt: sourceState.reachedAt,
            },
          });
          const targetBalance = target.balance + request.amount;
          const targetState = nextGoalState(target, targetBalance);
          await tx.goal.update({
            where: { id: target.id },
            data: {
              balance: targetBalance,
              status: targetState.status,
              reachedAt: targetState.reachedAt,
            },
          });

          const ids = targetState.justReached
            ? await this.notifications.recordGoalReached(tx, {
                customerId: actor.userId,
                storeId: account.storeId,
                storeName: account.store.name,
                accountNumber: account.number,
                currencyCode: account.currencyCode,
                operationId: null,
                goal: { ...target, balance: targetBalance },
              })
            : [];
          return {
            result: { movement: toGoalMovementView(movement), replayed: false },
            toNotify: ids,
          };
        },
      );
      // After the commit, without waiting (dispatch never throws).
      void this.notifications.dispatch(toNotify);
      return result;
    } catch (error) {
      // The same key sent in parallel for another account: the unique index
      // refused the second insert; the winner decides.
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        const winner = await this.replay(this.prisma, idempotencyKey, request);
        if (winner) {
          return winner;
        }
      }
      throw error;
    }
  }

  /** The account's movements (moves and closings), newest first. */
  async movements(
    userId: string,
    accountId: string,
    query: PaginationQueryDto,
  ): Promise<Paginated<GoalMovementView>> {
    await this.ownAccount(this.prisma, userId, accountId);
    const where = { accountId };
    const [rows, total] = await this.prisma.$transaction(
      [
        this.prisma.goalMovement.findMany({
          where,
          include: MOVEMENT_INCLUDE,
          // id breaks ties within one millisecond (uuid v7 is time-ordered).
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          ...toSkipTake(query),
        }),
        this.prisma.goalMovement.count({ where }),
      ],
      ONE_SNAPSHOT,
    );
    return paginated(rows.map(toGoalMovementView), total, query);
  }

  /**
   * The movement this key already recorded, if any: the same one gives its
   * view back (replayed), anything else is 409 IDEMPOTENCY_KEY_REUSED.
   */
  private async replay(
    client: Tx,
    idempotencyKey: string,
    request: MoveRequest,
  ): Promise<{ movement: GoalMovementView; replayed: boolean } | null> {
    const movement = await client.goalMovement.findUnique({
      where: { idempotencyKey },
      include: MOVEMENT_INCLUDE,
    });
    if (!movement) {
      return null;
    }
    const sameMove =
      movement.reason === GoalMovementReason.MOVE &&
      movement.accountId === request.accountId &&
      movement.authorId === request.authorId &&
      movement.sourceGoalId === request.sourceGoalId &&
      movement.targetGoalId === request.targetGoalId &&
      movement.amount === request.amount;
    if (!sameMove) {
      throw movementKeyReused();
    }
    return { movement: toGoalMovementView(movement), replayed: true };
  }

  async createProject(
    userId: string,
    accountId: string,
    dto: CreateProjectDto,
  ): Promise<ProjectView> {
    await this.ownAccount(this.prisma, userId, accountId);
    const project = await this.prisma.project.create({
      data: { accountId, name: dto.name },
    });
    return toProjectView(project);
  }

  async createGoal(
    userId: string,
    accountId: string,
    dto: CreateGoalDto,
  ): Promise<GoalView> {
    await this.ownAccount(this.prisma, userId, accountId);
    if (dto.projectId !== undefined) {
      const project = await this.prisma.project.findFirst({
        where: { id: dto.projectId, accountId },
        select: { id: true },
      });
      if (!project) {
        throw projectNotFound();
      }
    }
    if (dto.articleId !== undefined) {
      await this.linkableArticle(this.prisma, accountId, dto.articleId);
    }
    // A new goal holds nothing yet: below any target, so IN_PROGRESS.
    const goal = await this.prisma.goal.create({
      data: {
        accountId,
        label: dto.label,
        targetAmount: parseAmount(dto.targetAmount),
        projectId: dto.projectId ?? null,
        articleId: dto.articleId ?? null,
      },
      include: GOAL_INCLUDE,
    });
    return toGoalView(goal);
  }

  /**
   * Renames, retargets, or links a goal to an article (null unlinks); the
   * status follows the new target, silently.
   */
  async updateGoal(
    userId: string,
    accountId: string,
    goalId: string,
    dto: UpdateGoalDto,
  ): Promise<GoalView> {
    if (
      dto.label === undefined &&
      dto.targetAmount === undefined &&
      dto.articleId === undefined
    ) {
      throw nothingToUpdate();
    }
    return this.prisma.$transaction(async (tx) => {
      await this.ownAccount(tx, userId, accountId, { lock: true });
      const goal = await this.editableGoal(tx, accountId, goalId);
      if (dto.articleId) {
        await this.linkableArticle(tx, accountId, dto.articleId);
      }
      const targetAmount =
        dto.targetAmount === undefined
          ? goal.targetAmount
          : parseAmount(dto.targetAmount);
      // Retargeting never notifies: the customer chose the new target.
      const { status, reachedAt } = nextGoalState(
        { ...goal, targetAmount },
        goal.balance,
      );
      const updated = await tx.goal.update({
        where: { id: goalId },
        data: {
          label: dto.label,
          targetAmount,
          status,
          reachedAt,
          articleId: dto.articleId,
        },
        include: GOAL_INCLUDE,
      });
      return toGoalView(updated);
    });
  }

  /**
   * Closes a goal (user decision, 2026-10-22): what it holds goes back to the
   * Unassigned goal, recorded as a GOAL_CLOSED movement, in one transaction.
   */
  async closeGoal(
    actor: AuthenticatedUser,
    accountId: string,
    goalId: string,
  ): Promise<GoalView> {
    return this.prisma.$transaction(async (tx) => {
      await this.ownAccount(tx, actor.userId, accountId, { lock: true });
      const goal = await this.editableGoal(tx, accountId, goalId);
      if (goal.balance > 0n) {
        const unassigned = await tx.goal.findFirstOrThrow({
          where: { accountId, isSystem: true },
          select: { id: true },
        });
        await tx.goalMovement.create({
          data: {
            accountId,
            sourceGoalId: goalId,
            targetGoalId: unassigned.id,
            amount: goal.balance,
            reason: GoalMovementReason.GOAL_CLOSED,
            authorId: actor.userId,
            device: actor.deviceId,
          },
        });
        await tx.goal.update({
          where: { id: unassigned.id },
          data: { balance: { increment: goal.balance } },
        });
      }
      const closed = await tx.goal.update({
        where: { id: goalId },
        data: { balance: 0n, status: GoalStatus.CLOSED },
        include: GOAL_INCLUDE,
      });
      return toGoalView(closed);
    });
  }

  /**
   * The session user's own account, or 404. With `lock`, the row is read
   * `FOR UPDATE`: changes to goal balances wait for each other (and for
   * deposits), so no two of them work from the same stale balances.
   */
  async ownAccount(
    client: Tx,
    userId: string,
    accountId: string,
    options: { lock?: boolean } = {},
  ): Promise<void> {
    const rows = options.lock
      ? await client.$queryRaw<{ id: string }[]>`
          SELECT "id" FROM "accounts"
          WHERE "id" = ${accountId}::uuid AND "customerId" = ${userId}::uuid
          FOR UPDATE`
      : await client.account.findMany({
          where: { id: accountId, customerId: userId },
          select: { id: true },
        });
    if (rows.length === 0) {
      throw accountNotFound();
    }
  }

  /**
   * An article a goal of this account may be linked to: one of the account's
   * store (another store's is a 404), still on sale (409 ARTICLE_UNAVAILABLE).
   */
  private async linkableArticle(
    client: Tx,
    accountId: string,
    articleId: string,
  ): Promise<void> {
    const article = await client.article.findFirst({
      where: {
        id: articleId,
        store: { accounts: { some: { id: accountId } } },
      },
      select: { available: true },
    });
    if (!article) {
      throw articleNotFound();
    }
    if (!article.available) {
      throw articleUnavailable();
    }
  }

  /** A goal of this account that the customer may change: not system, not closed. */
  private async editableGoal(tx: Tx, accountId: string, goalId: string) {
    const goal = await tx.goal.findFirst({ where: { id: goalId, accountId } });
    if (!goal) {
      throw goalNotFound();
    }
    if (goal.isSystem) {
      throw systemGoal();
    }
    if (goal.status === GoalStatus.CLOSED) {
      throw goalClosed();
    }
    return goal;
  }
}
