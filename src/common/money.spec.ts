import 'reflect-metadata';
import { validateSync } from 'class-validator';
import {
  AMOUNT_RULE_MESSAGE,
  formatAmount,
  IsAmount,
  IsCountedAmount,
  isAmount,
  parseAmount,
} from './money.js';

class Dto {
  @IsAmount()
  amount: unknown;
}

function errorsFor(amount: unknown): string[] {
  const dto = new Dto();
  dto.amount = amount;
  return validateSync(dto).flatMap((e) => Object.values(e.constraints ?? {}));
}

describe('money', () => {
  it.each(['1', '500', '200000', '999999999999999999'])(
    'accepts %s',
    (value) => {
      expect(isAmount(value)).toBe(true);
      expect(errorsFor(value)).toEqual([]);
    },
  );

  it.each([
    ['zero', '0'],
    ['a negative amount', '-500'],
    ['an explicit plus sign', '+500'],
    ['decimals', '500.50'],
    ['a comma', '500,50'],
    ['a leading zero', '0500'],
    ['spaces', '200 000'],
    ['an empty string', ''],
    ['19 digits', '1000000000000000000'],
    ['an exponent', '1e6'],
  ])('rejects %s', (_label, value) => {
    expect(isAmount(value)).toBe(false);
    expect(errorsFor(value)).toContain(AMOUNT_RULE_MESSAGE);
    expect(() => parseAmount(value)).toThrow();
  });

  it.each([500, 500n, null, undefined])(
    'rejects the non-string %s',
    (value) => {
      expect(isAmount(value)).toBe(false);
      expect(errorsFor(value)).toContain(AMOUNT_RULE_MESSAGE);
    },
  );

  it('round-trips without losing precision beyond Number.MAX_SAFE_INTEGER', () => {
    const big = '999999999999999999';

    expect(parseAmount(big)).toBe(999999999999999999n);
    expect(formatAmount(parseAmount(big))).toBe(big);
    // A JSON number would have been rounded:
    expect(String(Number(big))).not.toBe(big);
  });
});

class CountedDto {
  @IsCountedAmount()
  amount: unknown;
}

describe('IsCountedAmount', () => {
  const isValid = (amount: unknown) => {
    const dto = new CountedDto();
    dto.amount = amount;
    return validateSync(dto).length === 0;
  };

  it('accepts 0 and whole numbers up to 18 digits', () => {
    for (const amount of ['0', '1', '48500', '9'.repeat(18)]) {
      expect(isValid(amount)).toBe(true);
    }
  });

  it('refuses a leading zero, a sign, decimals, 19 digits, and non-strings', () => {
    for (const amount of [
      '00',
      '01',
      '-1',
      '+1',
      '1.5',
      '9'.repeat(19),
      '',
      0,
      null,
    ]) {
      expect(isValid(amount)).toBe(false);
    }
  });
});
