import type { ConfigService } from '@nestjs/config';
import { hashPassword, verifyPassword } from '../admin-auth/secrets.js';
import type { EnvironmentVariables } from '../config/env.validation.js';
import { pepperPin, PinHasher } from './pin-hasher.js';

const PEPPER = 'p'.repeat(32);

function hasherWith(pepper: string) {
  const config = { get: vi.fn().mockReturnValue(pepper) };
  return new PinHasher(
    config as unknown as ConfigService<EnvironmentVariables, true>,
  );
}

describe('PinHasher', () => {
  it('verifies a PIN it hashed, and refuses another PIN', async () => {
    const hasher = hasherWith(PEPPER);
    const stored = await hasher.hash('482915');

    expect(stored).toMatch(/^scrypt\$/);
    expect(stored).not.toContain('482915');
    await expect(hasher.verify('482915', stored)).resolves.toBe(true);
    await expect(hasher.verify('482916', stored)).resolves.toBe(false);
  });

  it('cannot verify the PIN without the pepper', async () => {
    const stored = await hasherWith(PEPPER).hash('482915');

    // What an attacker with only the database would try.
    await expect(verifyPassword('482915', stored)).resolves.toBe(false);
    await expect(
      hasherWith('q'.repeat(32)).verify('482915', stored),
    ).resolves.toBe(false);
  });

  it('refuses a hash made without the pepper', async () => {
    const unpeppered = await hashPassword('482915');

    await expect(hasherWith(PEPPER).verify('482915', unpeppered)).resolves.toBe(
      false,
    );
  });

  it('peppers deterministically, and differently per pepper', () => {
    expect(pepperPin('482915', PEPPER)).toBe(pepperPin('482915', PEPPER));
    expect(pepperPin('482915', PEPPER)).not.toBe(
      pepperPin('482915', 'q'.repeat(32)),
    );
    expect(pepperPin('482915', PEPPER)).toMatch(/^[0-9a-f]{64}$/);
  });
});
