import { Module } from '@nestjs/common';
import { StoresController } from './stores.controller.js';
import { StoreRegistrationController } from './store-registration.controller.js';
import { StoreImportService } from './import/store-import.service.js';
import { StoresService } from './stores.service.js';

@Module({
  controllers: [StoresController, StoreRegistrationController],
  providers: [StoresService, StoreImportService],
})
export class StoresModule {}
