import { Injectable } from '@nestjs/common';
import { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import {
  toSecurityQuestionView,
  type SecurityQuestionView,
} from './dto/security-question.dto.js';
import { SECURITY_QUESTION_COUNT } from './security-questions.constants.js';
import {
  questionExists,
  questionNotFound,
  tooFewQuestions,
} from './security-questions.errors.js';

/** The list of security questions, managed by admins (14b). */
@Injectable()
export class SecurityQuestionsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(text: string): Promise<SecurityQuestionView> {
    try {
      const question = await this.prisma.securityQuestion.create({
        data: { text },
      });
      return toSecurityQuestionView(question);
    } catch (error) {
      // P2002: the text exists. Caught rather than checked first, so two
      // parallel requests cannot both pass a check.
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw questionExists();
      }
      throw error;
    }
  }

  async list(): Promise<SecurityQuestionView[]> {
    const questions = await this.prisma.securityQuestion.findMany({
      // id breaks ties within one millisecond (uuid v7 is time-ordered).
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
    return questions.map(toSecurityQuestionView);
  }

  async setActive(id: string, active: boolean): Promise<SecurityQuestionView> {
    return this.prisma.$transaction(async (tx) => {
      // Locked, then counted: two parallel deactivations cannot both see 4.
      const rows = await tx.$queryRaw<{ id: string }[]>`
        SELECT "id" FROM "security_questions" WHERE "active" FOR UPDATE`;
      const question = await tx.securityQuestion.findUnique({ where: { id } });
      if (!question) {
        throw questionNotFound();
      }
      const leaving = question.active && !active;
      if (leaving && rows.length <= SECURITY_QUESTION_COUNT) {
        throw tooFewQuestions(SECURITY_QUESTION_COUNT);
      }
      const updated = await tx.securityQuestion.update({
        where: { id },
        data: { active },
      });
      return toSecurityQuestionView(updated);
    });
  }
}
