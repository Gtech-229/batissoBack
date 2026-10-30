import { Injectable } from '@nestjs/common';
import type { AuthenticatedUser } from '../mobile-auth/authenticated-user.js';
import { notAuthenticated } from '../mobile-auth/mobile-auth.errors.js';
import { PinCheck } from '../mobile-auth/pin-check.service.js';
import { PinHasher } from '../mobile-auth/pin-hasher.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type {
  MySecurityQuestions,
  SecurityAnswerDto,
} from './dto/security-answers.dto.js';
import { normalizeAnswer } from './normalize-answer.js';
import {
  answersNotDistinct,
  questionUnavailable,
} from './security-questions.errors.js';

const VIEW = { id: true, text: true } as const;

/** A user's own security questions (14b). Answers never leave this service. */
@Injectable()
export class SecurityAnswersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly pinCheck: PinCheck,
    private readonly pinHasher: PinHasher,
  ) {}

  async mine(userId: string): Promise<MySecurityQuestions> {
    const [chosen, available] = await Promise.all([
      this.prisma.securityQuestion.findMany({
        where: { answers: { some: { userId } } },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        select: VIEW,
      }),
      this.prisma.securityQuestion.findMany({
        where: { active: true },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        select: VIEW,
      }),
    ]);
    return { configured: chosen.length > 0, chosen, available };
  }

  /**
   * Sets the user's three answers, replacing any before. The current PIN is
   * required: a borrowed unlocked phone must not be able to rewrite recovery.
   */
  async set(
    actor: AuthenticatedUser,
    currentPin: string,
    answers: SecurityAnswerDto[],
  ): Promise<void> {
    const normalized = answers.map(({ answer }) => normalizeAnswer(answer));
    const questionIds = answers.map(({ questionId }) => questionId);
    if (
      new Set(questionIds).size !== answers.length ||
      new Set(normalized).size !== answers.length
    ) {
      throw answersNotDistinct();
    }
    const offered = await this.prisma.securityQuestion.count({
      where: { id: { in: questionIds }, active: true },
    });
    if (offered !== answers.length) {
      throw questionUnavailable();
    }

    // After the checks above: a badly formed request costs no PIN attempt.
    await this.pinCheck.verify(actor.userId, currentPin);
    // The slow scrypt work happens before the transaction (short row lock).
    const hashes = await Promise.all(
      normalized.map((answer) => this.pinHasher.hash(answer)),
    );

    const saved = await this.prisma.$transaction(async (tx) => {
      // The lock a reset takes: a reset that revoked this session wins.
      await tx.$queryRaw`
        SELECT 1 FROM "users" WHERE "id" = ${actor.userId}::uuid FOR UPDATE`;
      const live = await tx.userSession.count({
        where: { id: actor.sessionId, revokedAt: null },
      });
      if (live === 0) {
        return false;
      }
      await tx.userSecurityAnswer.deleteMany({
        where: { userId: actor.userId },
      });
      await tx.userSecurityAnswer.createMany({
        data: questionIds.map((questionId, index) => ({
          userId: actor.userId,
          questionId,
          answerHash: hashes[index],
        })),
      });
      return true;
    });
    if (!saved) {
      throw notAuthenticated();
    }
  }
}
