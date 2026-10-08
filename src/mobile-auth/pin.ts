import { ValidateBy, type ValidationOptions } from 'class-validator';

export const PIN_LENGTH = 6;

export const PIN_RULE_MESSAGE =
  'Le code PIN doit contenir exactement 6 chiffres, sans chiffres tous identiques ni suite (123456, 654321)';

// ASCII digits only: \d would also accept other scripts' digits.
const PIN_PATTERN = /^[0-9]{6}$/;

/**
 * True for a PIN a user may choose: 6 digits, not all the same (`000000`) and
 * not a straight run up or down (`123456`, `654321`), the first guesses of anyone
 * trying PINs.
 */
export function isAcceptablePin(value: unknown): value is string {
  if (typeof value !== 'string' || !PIN_PATTERN.test(value)) {
    return false;
  }
  // Safe to split per character: the pattern above allows ASCII digits only.
  const digits = value.split('').map(Number);
  const steps = digits.slice(1).map((digit, i) => digit - digits[i]);
  const sameStep = steps.every((step) => step === steps[0]);
  // A constant step of 0 is "all the same"; of +1 or -1, a straight run.
  return !(sameStep && Math.abs(steps[0]) <= 1);
}

/**
 * Validates a PIN being chosen. Checking an existing PIN only needs its format:
 * a weak PIN chosen before a rule change must still be accepted at sign-in.
 */
export function IsPin(options?: ValidationOptions): PropertyDecorator {
  return ValidateBy(
    {
      name: 'isPin',
      validator: { validate: (value) => isAcceptablePin(value) },
    },
    { message: PIN_RULE_MESSAGE, ...options },
  );
}
