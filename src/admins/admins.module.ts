import { Module } from '@nestjs/common';
import { AdminsController } from './admins.controller.js';
import { AdminsService } from './admins.service.js';

@Module({
  controllers: [AdminsController],
  providers: [AdminsService],
})
export class AdminsModule {}
