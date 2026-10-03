import { BadRequestException } from '@nestjs/common';
import type { ValidationError } from 'class-validator';
import { VALIDATION_ERROR_MESSAGE } from '../errors/error-messages.js';
import type { ValidationErrorDetail } from '../errors/error-response.js';

// class-validator's own message for this constraint is English; DTO messages are written in French.
const FORBIDDEN_PROPERTY_MESSAGE = "Ce champ n'est pas autorisé";

/**
 * Keeps only field paths and messages. The raw ValidationError also holds `target`
 * (the whole request body) and `value`, which must never reach the client.
 */
export function toValidationDetails(
  errors: ValidationError[],
  parentPath = '',
): ValidationErrorDetail[] {
  return errors.flatMap((error) => {
    const field = parentPath
      ? `${parentPath}.${error.property}`
      : error.property;
    const own = error.constraints
      ? [{ field, errors: toMessages(error.constraints) }]
      : [];
    return [...own, ...toValidationDetails(error.children ?? [], field)];
  });
}

function toMessages(constraints: Record<string, string>): string[] {
  return Object.entries(constraints).map(([name, message]) =>
    name === 'whitelistValidation' ? FORBIDDEN_PROPERTY_MESSAGE : message,
  );
}

export function validationExceptionFactory(
  errors: ValidationError[],
): BadRequestException {
  return new BadRequestException({
    message: VALIDATION_ERROR_MESSAGE,
    details: toValidationDetails(errors),
  });
}
