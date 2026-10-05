import { Module } from '@nestjs/common';
import { SystemSettingsController } from './system-settings.controller.js';
import { SystemSettingsService } from './system-settings.service.js';

@Module({
  controllers: [SystemSettingsController],
  providers: [SystemSettingsService],
  exports: [SystemSettingsService],
})
export class SystemSettingsModule {}
