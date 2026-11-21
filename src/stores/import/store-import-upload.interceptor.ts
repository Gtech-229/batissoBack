import {
  BadRequestException,
  Injectable,
  PayloadTooLargeException,
  type CallHandler,
  type ExecutionContext,
  type NestInterceptor,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Observable } from 'rxjs';
import {
  IMPORT_BODY_INVALID,
  IMPORT_FILE_TOO_LARGE,
  importFileRefused,
} from '../stores.errors.js';
import { MAX_IMPORT_BYTES } from './store-import-columns.js';

/**
 * Multer for one import file (26a), kept in memory: with no `storage` or
 * `dest`, nothing touches the disk. The limits stop the read as soon as they
 * are crossed: a bigger file, a second file, any other field.
 */
const MulterImportInterceptor = FileInterceptor('file', {
  limits: { fileSize: MAX_IMPORT_BYTES, files: 1, fields: 0 },
});

@Injectable()
export class StoreImportUploadInterceptor implements NestInterceptor {
  private readonly multer = new MulterImportInterceptor();

  async intercept(
    context: ExecutionContext,
    next: CallHandler,
  ): Promise<Observable<unknown>> {
    try {
      return await this.multer.intercept(context, next);
    } catch (error) {
      // Nest maps multer's errors to English 413 and 400s: one French family
      // instead, like the photo uploads.
      if (error instanceof PayloadTooLargeException) {
        throw importFileRefused('IMPORT_FILE_INVALID', IMPORT_FILE_TOO_LARGE);
      }
      if (error instanceof BadRequestException) {
        throw importFileRefused('IMPORT_FILE_INVALID', IMPORT_BODY_INVALID);
      }
      throw error;
    }
  }
}
