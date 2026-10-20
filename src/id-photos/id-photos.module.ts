import { Module } from '@nestjs/common';
import { AccountsModule } from '../accounts/accounts.module.js';
import { IdPhotoStorage } from './id-photo-storage.js';
import { IdPhotosController } from './id-photos.controller.js';
import { IdPhotosService } from './id-photos.service.js';

/** Customers' identity photos, kept in the private `ID_PHOTO_DIR` directory. */
@Module({
  imports: [AccountsModule],
  controllers: [IdPhotosController],
  providers: [IdPhotoStorage, IdPhotosService],
})
export class IdPhotosModule {}
