import { newQrCode, QR_CODE_PATTERN } from './qr-code.js';

describe('newQrCode', () => {
  it('gives 32 base64url characters, the input pattern', () => {
    const code = newQrCode();

    expect(code).toHaveLength(32);
    expect(code).toMatch(QR_CODE_PATTERN);
  });

  it('gives a different code each time', () => {
    const codes = new Set(Array.from({ length: 100 }, () => newQrCode()));

    expect(codes.size).toBe(100);
  });
});

describe('QR_CODE_PATTERN', () => {
  it.each([
    ['too short', 'a'.repeat(31)],
    ['too long', 'a'.repeat(33)],
    ['outside base64url', `${'a'.repeat(31)}+`],
    ['padded', `${'a'.repeat(31)}=`],
  ])('refuses a code %s', (_, code) => {
    expect(QR_CODE_PATTERN.test(code)).toBe(false);
  });
});
