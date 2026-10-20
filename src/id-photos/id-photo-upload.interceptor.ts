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
  invalidPhoto,
  MAX_PHOTO_BYTES,
  PHOTO_ONLY,
  PHOTO_TOO_LARGE,
} from './id-photos.errors.js';

/**
 * Nest's multer interceptor for one identity photo, with French errors.
 *
 * Multer reads the multipart body before the handler runs and puts the file on
 * `request.file`. With no `storage` or `dest` option, multer keeps the file in
 * memory (a Buffer of at most 5 MB), so nothing touches the disk before the
 * content is checked. The limits stop the read as
 * soon as they are crossed: a bigger file, a second file, any other field.
 */
const MulterPhotoInterceptor = FileInterceptor('photo', {
  limits: { fileSize: MAX_PHOTO_BYTES, files: 1, fields: 0 },
});

@Injectable()
export class IdPhotoUploadInterceptor implements NestInterceptor {
  private readonly multer = new MulterPhotoInterceptor();

  async intercept(
    context: ExecutionContext,
    next: CallHandler,
  ): Promise<Observable<unknown>> {
    try {
      return await this.multer.intercept(context, next);
    } catch (error) {
      // Nest maps multer's limits and malformed bodies to English 413 and 400
      // errors; the app gets one family instead: a French 400 on `photo`.
      if (error instanceof PayloadTooLargeException) {
        throw invalidPhoto(PHOTO_TOO_LARGE);
      }
      if (error instanceof BadRequestException) {
        throw invalidPhoto(PHOTO_ONLY);
      }
      throw error;
    }
  }
}
