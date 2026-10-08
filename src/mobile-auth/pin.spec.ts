import 'reflect-metadata';
import { validateSync } from 'class-validator';
import { IsPin, isAcceptablePin, PIN_RULE_MESSAGE } from './pin.js';

class Dto {
  @IsPin()
  pin: unknown;
}

function errorsFor(pin: unknown): string[] {
  const dto = new Dto();
  dto.pin = pin;
  return validateSync(dto).flatMap((e) => Object.values(e.constraints ?? {}));
}

describe('PIN rule', () => {
  it.each(['482915', '102938', '135790', '112233', '012346', '987650'])(
    'accepts %s',
    (pin) => {
      expect(isAcceptablePin(pin)).toBe(true);
      expect(errorsFor(pin)).toEqual([]);
    },
  );

  it.each([
    ['5 digits', '48291'],
    ['7 digits', '4829151'],
    ['a letter', '48291a'],
    ['a space', '482 91'],
    ['surrounding spaces', ' 482915 '],
    ['a sign', '+48291'],
    ['non-ASCII digits', '٤٨٢٩١٥'],
    ['empty', ''],
    ['a number, not a string', 482915],
    ['null', null],
  ])('refuses %s', (_label, pin) => {
    expect(isAcceptablePin(pin)).toBe(false);
    expect(errorsFor(pin)).toEqual([PIN_RULE_MESSAGE]);
  });

  it.each(['000000', '111111', '999999'])(
    'refuses all-same digits %s',
    (pin) => {
      expect(isAcceptablePin(pin)).toBe(false);
    },
  );

  it.each(['012345', '123456', '456789', '987654', '654321', '543210'])(
    'refuses the straight run %s',
    (pin) => {
      expect(isAcceptablePin(pin)).toBe(false);
    },
  );
});
