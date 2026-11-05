import { Module } from '@nestjs/common';
import { StoresController } from './stores.controller.js';
import { StoreRegistrationController } from './store-registration.controller.js';
import { StoresService } from './stores.service.js';

@Module({
  controllers: [StoresController, StoreRegistrationController],
  providers: [StoresService],
})
export class StoresModule {}
