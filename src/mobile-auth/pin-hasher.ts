import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac } from 'node:crypto';
import { hashPassword, verifyPassword } from '../admin-auth/secrets.js';
import type { EnvironmentVariables } from '../config/env.validation.js';

/**
 * The value scrypt actually hashes: an HMAC of the PIN keyed with the server's
 * pepper. Without the pepper, a stolen hash cannot be tested against the million
 * possible PINs.
 */
export function pepperPin(pin: string, pepper: string): string {
  return createHmac('sha256', pepper).update(pin).digest('hex');
}

/** Hashes and checks PINs with the pepper from `PIN_PEPPER`. */
@Injectable()
export class PinHasher {
  private readonly pepper: string;

  constructor(config: ConfigService<EnvironmentVariables, true>) {
    this.pepper = config.get('PIN_PEPPER', { infer: true });
  }

  hash(pin: string): Promise<string> {
    return hashPassword(pepperPin(pin, this.pepper));
  }

  verify(pin: string, storedHash: string): Promise<boolean> {
    return verifyPassword(pepperPin(pin, this.pepper), storedHash);
  }
}
