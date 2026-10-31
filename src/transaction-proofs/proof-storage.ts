import { Injectable, type OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { resolve } from 'node:path';
import type { EnvironmentVariables } from '../config/env.validation.js';
import { PrivatePhotoStorage } from '../id-photos/private-photo-storage.js';

/** The private directory of the proofs of transactions (`PROOF_DIR`). */
@Injectable()
export class ProofStorage extends PrivatePhotoStorage implements OnModuleInit {
  constructor(config: ConfigService<EnvironmentVariables, true>) {
    super(resolve(config.get('PROOF_DIR', { infer: true })), 'Proof photo');
  }
}
