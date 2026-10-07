import { definedOnly } from './defined-only.js';

class PartialDto {
  name?: string;
  decimals?: number;
  active?: boolean;
}

describe('definedOnly', () => {
  it('drops undefined fields of a DTO instance', () => {
    const dto = Object.assign(new PartialDto(), { name: 'Mali' });

    expect(definedOnly(dto)).toEqual({ name: 'Mali' });
  });

  it('keeps falsy values that were actually sent', () => {
    expect(definedOnly({ decimals: 0, active: false, name: '' })).toEqual({
      decimals: 0,
      active: false,
      name: '',
    });
  });

  it('keeps null, which means "clear this field"', () => {
    expect(definedOnly({ terms: null, other: undefined })).toEqual({
      terms: null,
    });
  });
});
