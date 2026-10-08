import 'reflect-metadata';
import { generateKeyPairSync, sign, type KeyObject } from 'node:crypto';
import { validateSync } from 'class-validator';
import {
  DEVICE_KEY_MESSAGE,
  IsDevicePublicKey,
  isValidDeviceSignature,
  parseDevicePublicKey,
} from './device-key.js';

function p256() {
  const { publicKey, privateKey } = generateKeyPairSync('ec', {
    namedCurve: 'prime256v1',
  });
  return {
    publicKey: publicKey
      .export({ format: 'der', type: 'spki' })
      .toString('base64'),
    sign: (message: string) =>
      sign('sha256', Buffer.from(message), privateKey).toString('base64'),
  };
}

const spki = (key: KeyObject) =>
  key.export({ format: 'der', type: 'spki' }).toString('base64');

class Dto {
  @IsDevicePublicKey()
  publicKey: unknown;
}

describe('device keys', () => {
  it('accepts a P-256 public key in SPKI DER base64', () => {
    const device = p256();

    expect(parseDevicePublicKey(device.publicKey)).not.toBeNull();
    const dto = Object.assign(new Dto(), { publicKey: device.publicKey });
    expect(validateSync(dto)).toEqual([]);
  });

  it.each([
    [
      'a P-384 key',
      () =>
        spki(generateKeyPairSync('ec', { namedCurve: 'secp384r1' }).publicKey),
    ],
    [
      'an RSA key',
      () => spki(generateKeyPairSync('rsa', { modulusLength: 2048 }).publicKey),
    ],
    ['an Ed25519 key', () => spki(generateKeyPairSync('ed25519').publicKey)],
    ['base64 garbage', () => Buffer.from('not a key').toString('base64')],
    ['text that is not base64', () => 'not base64 !'],
    ['an oversized value', () => 'A'.repeat(501)],
    ['a number', () => 42],
  ])('refuses %s', (_label, value) => {
    expect(parseDevicePublicKey(value())).toBeNull();
    const dto = Object.assign(new Dto(), { publicKey: value() });
    expect(
      validateSync(dto).flatMap((e) => Object.values(e.constraints ?? {})),
    ).toEqual([DEVICE_KEY_MESSAGE]);
  });

  it('verifies a signature made by the matching private key', () => {
    const device = p256();

    expect(
      isValidDeviceSignature(
        device.publicKey,
        'challenge-1',
        device.sign('challenge-1'),
      ),
    ).toBe(true);
  });

  it.each([
    [
      'another message',
      (d: ReturnType<typeof p256>) => [
        d.publicKey,
        'challenge-1',
        d.sign('challenge-2'),
      ],
    ],
    [
      'another key',
      (d: ReturnType<typeof p256>) => [
        p256().publicKey,
        'challenge-1',
        d.sign('challenge-1'),
      ],
    ],
    [
      'a malformed signature',
      (d: ReturnType<typeof p256>) => [d.publicKey, 'challenge-1', 'AAAA'],
    ],
    [
      'non-base64 text',
      (d: ReturnType<typeof p256>) => [
        d.publicKey,
        'challenge-1',
        'not base64 !',
      ],
    ],
    [
      'an invalid public key',
      (d: ReturnType<typeof p256>) => [
        'bm90IGEga2V5',
        'challenge-1',
        d.sign('challenge-1'),
      ],
    ],
  ])('refuses a signature with %s', (_label, args) => {
    const [publicKey, message, signature] = args(p256());

    expect(isValidDeviceSignature(publicKey, message, signature)).toBe(false);
  });
});
