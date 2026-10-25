import { Module } from '@nestjs/common';
import { MyQrCodeController } from './my-qr-code.controller.js';
import { QrCodesService } from './qr-codes.service.js';
import { StoreQrCodeController } from './store-qr-code.controller.js';

/** The QR codes of users and stores, and their scans (feature 23). */
@Module({
  controllers: [MyQrCodeController, StoreQrCodeController],
  providers: [QrCodesService],
  exports: [QrCodesService],
})
export class QrCodesModule {}
