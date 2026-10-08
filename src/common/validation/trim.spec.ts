import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { Trim, TrimLowerCase, TrimUpperCase } from './trim.js';

class Dto {
  @Trim()
  name: unknown;

  @TrimUpperCase()
  code: unknown;

  @TrimLowerCase()
  email: unknown;
}

const transform = (plain: Record<string, unknown>) =>
  plainToInstance(Dto, plain);

describe('trim decorators', () => {
  it('trims, then changes the case when asked', () => {
    expect(
      transform({ name: '  Bamako ', code: ' ml ', email: ' Awa@Batisso.ML ' }),
    ).toEqual({ name: 'Bamako', code: 'ML', email: 'awa@batisso.ml' });
  });

  it.each([42, null, undefined, ['a '], { a: 1 }])(
    'leaves a non-string value (%j) for the validators',
    (value) => {
      const dto = transform({ name: value, code: value, email: value });

      expect(dto.name).toEqual(value);
      expect(dto.code).toEqual(value);
      expect(dto.email).toEqual(value);
    },
  );
});
