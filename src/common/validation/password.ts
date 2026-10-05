import { applyDecorators } from '@nestjs/common';
import { IsString, Matches } from 'class-validator';

export const PASSWORD_RULE_MESSAGE =
  'Le mot de passe doit contenir entre 8 et 128 caractères, dont au moins une majuscule, une minuscule, un chiffre et un caractère spécial';

// Lookaheads: one lowercase, one uppercase, one digit, one character that is
// neither a letter nor a digit; then 8 to 128 characters in total. Unicode
// classes so accented letters (é, É) count as letters, not special characters.
const PASSWORD_PATTERN =
  /^(?=.*\p{Ll})(?=.*\p{Lu})(?=.*\p{Nd})(?=.*[^\p{L}\p{N}]).{8,128}$/u;

export function isValidPassword(value: unknown): boolean {
  return typeof value === 'string' && PASSWORD_PATTERN.test(value);
}

/** Password rule shared by every DTO and by SUPER_ADMIN_PASSWORD. */
export function IsPassword(): PropertyDecorator {
  return applyDecorators(
    IsString({ message: PASSWORD_RULE_MESSAGE }),
    Matches(PASSWORD_PATTERN, { message: PASSWORD_RULE_MESSAGE }),
  );
}
