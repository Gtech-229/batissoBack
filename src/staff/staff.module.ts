import { Module } from '@nestjs/common';
import { StaffController } from './staff.controller.js';
import { StaffService } from './staff.service.js';

/**
 * A store's team, managed from the mobile app. StoreAccessGuard (attached by
 * `StoreRoles`) is resolved here: it needs only Reflector and the global
 * PrismaService.
 */
@Module({
  controllers: [StaffController],
  providers: [StaffService],
})
export class StaffModule {}
