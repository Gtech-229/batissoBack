import { getPhonePrefix, isPhoneCountry, normalizePhone } from './phone.js';

describe('phone', () => {
  it('derives the international prefix of a country', () => {
    expect(getPhonePrefix('ML')).toBe('+223');
    expect(getPhonePrefix('CI')).toBe('+225');
  });

  it('knows which ISO codes have a phone prefix', () => {
    expect(isPhoneCountry('ML')).toBe(true);
    expect(isPhoneCountry('AQ')).toBe(false);
  });

  it.each([
    ['local format with spaces', '76 00 00 00'],
    ['international with spaces', '+223 76 00 00 00'],
    ['E.164', '+22376000000'],
  ])('normalizes a Malian number in %s', (_label, value) => {
    expect(normalizePhone(value, 'ML')).toBe('+22376000000');
  });

  it('normalizes an Ivorian number in local format', () => {
    expect(normalizePhone('07 00 00 00 00', 'CI')).toBe('+2250700000000');
  });

  it.each([
    ['ML', '00 00 00 00'],
    ['CI', '00 00 00 00 00'],
  ])(
    'rejects a number of the right length outside the real ranges of %s',
    (country, value) => {
      expect(normalizePhone(value, country as 'ML' | 'CI')).toBeNull();
    },
  );

  it.each([
    ['a valid Ivorian number', '+225 07 00 00 00 00'],
    ['too short', '12'],
    ['not a number', 'abc'],
    ['empty', ''],
  ])('rejects %s for Mali', (_label, value) => {
    expect(normalizePhone(value, 'ML')).toBeNull();
  });
});
