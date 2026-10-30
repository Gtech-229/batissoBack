import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';

// `error` is the stable code the apps rely on; `message` is shown to users.

export function questionExists(): ConflictException {
  return new ConflictException({
    message: 'Cette question existe déjà',
    error: 'SECURITY_QUESTION_EXISTS',
  });
}

export function questionNotFound(): NotFoundException {
  return new NotFoundException('Question introuvable');
}

export function invalidQuestionId(): BadRequestException {
  return new BadRequestException('Identifiant de question invalide');
}

/** The same question twice, or the same answer to two questions. */
export function answersNotDistinct(): BadRequestException {
  return new BadRequestException({
    message: 'Choisissez trois questions et trois réponses différentes',
    error: 'SECURITY_ANSWERS_NOT_DISTINCT',
  });
}

/** An unknown question, or one no longer offered. */
export function questionUnavailable(): BadRequestException {
  return new BadRequestException({
    message: 'Cette question n’est plus proposée',
    error: 'SECURITY_QUESTION_UNAVAILABLE',
  });
}

/** Users choose 3 distinct questions: the list never drops below that. */
export function tooFewQuestions(minimum: number): ConflictException {
  return new ConflictException({
    message: `Il faut garder au moins ${minimum} questions actives`,
    error: 'TOO_FEW_SECURITY_QUESTIONS',
  });
}
