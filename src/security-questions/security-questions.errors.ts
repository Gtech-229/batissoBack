import { BadRequestException } from '@nestjs/common';

// `error` is the stable code the apps rely on; `message` is shown to users.

/** The same question twice, or the same answer to two questions. */
export function answersNotDistinct(): BadRequestException {
  return new BadRequestException({
    message: 'Choisissez des questions différentes et des réponses différentes',
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
