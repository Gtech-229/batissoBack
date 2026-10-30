import { ValidateBy, type ValidationOptions } from 'class-validator';

export const ANSWER_MIN_LENGTH = 2;
export const ANSWER_MAX_LENGTH = 100;

export const ANSWER_RULE_MESSAGE = `La réponse doit contenir ${ANSWER_MIN_LENGTH} à ${ANSWER_MAX_LENGTH} caractères`;

/**
 * The form of an answer that is hashed and compared: `  École  Mandé ` and
 * `ecole mande` are the same answer, so a capital, an accent, or a space never
 * costs a user one of their few tries.
 */
export function normalizeAnswer(answer: string): string {
  return answer
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function isAcceptableAnswer(value: unknown): value is string {
  if (typeof value !== 'string') {
    return false;
  }
  const { length } = normalizeAnswer(value);
  return length >= ANSWER_MIN_LENGTH && length <= ANSWER_MAX_LENGTH;
}

/** Validates an answer by its normalized form, the one that counts. */
export function IsSecurityAnswer(
  options?: ValidationOptions,
): PropertyDecorator {
  return ValidateBy(
    {
      name: 'isSecurityAnswer',
      validator: {
        validate: (value) => isAcceptableAnswer(value),
        defaultMessage: () => ANSWER_RULE_MESSAGE,
      },
    },
    options,
  );
}
