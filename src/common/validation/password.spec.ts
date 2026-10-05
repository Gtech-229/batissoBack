import 'reflect-metadata';
import { validateSync } from 'class-validator';
import {
  IsPassword,
  isValidPassword,
  PASSWORD_RULE_MESSAGE,
} from './password.js';

class Dto {
  @IsPassword()
  password: unknown;
}

function errorsFor(password: unknown): string[] {
  const dto = new Dto();
  dto.password = password;
  return validateSync(dto).flatMap((e) => Object.values(e.constraints ?? {}));
}

describe('password rule', () => {
  it.each(['Batisso#26', 'aB3!efgh', 'Mot de passe 2026', 'Éte-2026x'])(
    'accepts %s',
    (password) => {
      expect(isValidPassword(password)).toBe(true);
      expect(errorsFor(password)).toEqual([]);
    },
  );

  it.each([
    ['too short', 'aB3!efg'],
    ['no uppercase', 'batisso#26'],
    ['no lowercase', 'BATISSO#26'],
    ['no digit', 'Batisso#xx'],
    ['no special character', 'Batisso2026'],
    ['an accented letter as the only "special"', 'Élève2026'],
    ['too long', `aB3!${'x'.repeat(125)}`],
  ])('rejects a password with %s', (_label, password) => {
    expect(isValidPassword(password)).toBe(false);
    expect(errorsFor(password)).toContain(PASSWORD_RULE_MESSAGE);
  });

  it('accepts exactly 128 characters', () => {
    expect(isValidPassword(`aB3!${'x'.repeat(124)}`)).toBe(true);
  });

  it.each([undefined, null, 12345678])('rejects the non-string %s', (value) => {
    expect(isValidPassword(value)).toBe(false);
    expect(errorsFor(value)).toContain(PASSWORD_RULE_MESSAGE);
  });
});
