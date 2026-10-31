import { Injectable, type OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { resolve } from 'node:path';
import type { EnvironmentVariables } from '../config/env.validation.js';
import { PrivatePhotoStorage } from './private-photo-storage.js';

export {
  contentTypeOf,
  detectImageType,
  isPhotoName,
  type ImageType,
} from './private-photo-storage.js';

/** The private directory of the identity photos (`ID_PHOTO_DIR`). */
@Injectable()
export class IdPhotoStorage
  extends PrivatePhotoStorage
  implements OnModuleInit
{
  constructor(config: ConfigService<EnvironmentVariables, true>) {
    super(
      resolve(config.get('ID_PHOTO_DIR', { infer: true })),
      'Identity photo',
    );
  }
}
